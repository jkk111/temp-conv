var express = require("express");
var queue = [];
var processing = [];
var processed = [];
var crypto = require("crypto");
var app = express();
var multer = require("multer");
var bodyParser = require("body-parser");
app.use(bodyParser.urlencoded({extended: true}));
var cookieParser = require("cookie-parser");
app.use(cookieParser());
var storage = multer.diskStorage({});
var upload = multer({storage: storage});
var ffmpeg = require("fluent-ffmpeg");
var ffprobe = ffmpeg.ffprobe;
var encoders = require("./encoders.js");
var https = require("https");
var fs = require("fs");
const MAX_THREADS = 4;
var activeThreads = 0;
var HOUR = 60 * 60 * 1000;
var DAY = 24 * HOUR;
var KB = 1024;
var MB = KB * 1024;
var GB = MB * 1024;

var expiration = {
  anonymous: HOUR,
  registered: DAY,
  admin: DAY * 365 * 10
}

var maxSize = {
  anonymous: 5 * MB,
  registered: 25 * MB,
  admin: 5 * GB
}

var accounts;
var tokens;
try {
  accounts = JSON.parse(fs.readFileSync("accounts.json", "utf8"));
} catch(e) {
  accounts = {};
}

try {
  tokens = JSON.parse(fs.readFileSync("tokens.json", "utf8"));
} catch(e) {
  tokens = {};
}

try {
  var admin = JSON.parse(fs.readFileSync("admin.json", "utf8"));
  var tmp = {};
  tmp[admin.username] = {};
  tmp[admin.username].password = admin.password;
  tmp[admin.username].type = "admin";
  combine(accounts, tmp, true);
  writeAccounts();
} catch(e) {
  console.error("NO ADMIN FOUND... CLOSING", e);
  var template = {
    username: "admin",
    password: "admin"
  }
  fs.writeFileSync("admin.json", JSON.stringify(template, null, "  "), "utf8");
  process.exit();
}

var server;

function combine(obj1, obj2, overwrite) {
  for(var el in obj2) {
    if(!obj1[el] || overwrite) {
      obj1[el] = obj2[el];
    }
  }
}

try {
  var opts = {
    key: fs.readFileSync(__dirname + "/ssl.key"),
    cert: fs.readFileSync(__dirname + "/ssl.crt"),
    ca: fs.readFileSync(__dirname + "/root.crt")
  }
  server = https.createServer(opts, app).listen(443);
} catch(e) {
  var http = require("http");
  server = http.createServer(app).listen(80);
}

var tokens = {}, credentials = {};

var io = require("socket.io")(server);
try {
  fs.mkdirSync("encoded");
} catch(e) {

}

io.on("connection", function(socket) {
  socket.on("register", function(room) {
    socket.room = room;
    socket.join(room);
    socket.emit("update", calculateStatus(room));
  });
});

function pushUpdates(key, data, status) {
  data = data || calculateStatus(key);
  io.to(key).emit("update", data);
}

try {
  processed = JSON.parse(fs.readFileSync("uploads.json"), "utf8");
} catch(e) {
  processed = [];
}
pruneExpired();
setInterval(pruneExpired, 60000);
pruneRemnants();

function pruneRemnants() {
  var files = fs.readdirSync("encoded/");
  for(var i = 0 ; i < files.length; i++) {
    checkFileNotRemnant(files[i]);
  }
}

function checkFileNotRemnant(file) {
  var baseName = file.substring(0, file.lastIndexOf("."));
  var exists = checkIfInArr(processed, baseName);
  if(!exists) {
    try {
      fs.unlinkSync(`encoded/${file}`);
    } catch(e) { console.error("error pruning remnant", e); }
  }
}

app.use(express.static("static/"));

app.use("/upload", upload.single("file"), function(req, res, next) {
  req.cookies = req.cookies || [];
  var token = req.cookies.token;
  if(token && tokens[token]) {
    var user = tokens[token].username;
    req.encodeType = accounts[user].type;
  }
  req.encodeType = req.encodeType || "anonymous";
  next();
})

app.post("/upload", function(req, res, next) {
  var max = maxSize[req.encodeType || "anonymous"];
  if(req.file.size > max) {
    return res.status(400).send({ error: "ESIZE" });
  }
  next();
});

// Accepts upload and sends the user a key to check the file.
app.post("/upload", function(req, res) {
  if(!req.body.formats) req.body.formats = encoders.FORMATS;
  for(var i = 0 ; i < req.body.formats.length; i++) {
    var format = req.body.formats[i];
    if(encoders.FORMATS.indexOf(format) == -1) req.body.formats.splice(i--, 1);
  }
  if(req.file && (req.file.mimetype.indexOf("video") != -1 || req.file.mimetype == "image/gif")) {
    var data = {
      filename: req.file.originalname,
      path: req.file.path,
      id: req.file.filename,
      added: new Date().getTime(),
      formats: req.body.formats,
      uploadedAs: req.encodeType,
      callbackUrl: req.body.callback
    }
    ffprobe(data.path, function(err, metadata) {
      // console.log(metadata);
    });
    if(activeThreads < MAX_THREADS)
      encode(data, req.body.formats);
    else
      queue.push(data);
    res.send({id: req.file.filename});
  } else return res.status(400).send({error: "INVALID_REQUEST"});
});

app.get("/watch/:key.json", function(req, res) {
  var key = req.params.key;
  var queued = checkIfInArr(queue, key);
  if(!queued) {
    var inProcessing = checkIfInArr(processing, key);
    if(!inProcessing) {
      var isProcessed = checkIfInArr(processed, key);
      if(!isProcessed) {
        res.json({error: 404});
      } else {
      var tmp = buildStatusObj(isProcessed, "processed");
      res.json(tmp);
      }
    } else {
      var tmp = buildStatusObj(inProcessing, "processing");
      res.json(tmp);
    }
  } else {
    res.json({status: "queued", position: getPosInQueue(key)});
  }
});

app.post("/register", function(req, res) {
  var username = req.body.username;
  var password = req.body.password;
  if(!username || !password) return res.status(400).send("EPARAMS");
  if(accounts[username]) return res.status(400).send({ error: "EEXISTS" });
  accounts[username] = {
    password: password,
    type: "registered"
  }
  writeAccounts();
  doLogin(username, password, function(err, result) {
    if(err) return res.status(400).send({ error: "EINVALID" })
    res.cookie("token", result.token, { maxAge: DAY * 7 }).send(result);
  });
});

app.post("/login", function(req, res) {
  var username = req.body.username;
  var password = req.body.password;
  if(!username || !password) return res.status(400).send({ error: "EPARAMS" });
  doLogin(username, password, function(err, result) {
    if(err) return res.status(400).send(err);
    res.cookie("token", result.token, { maxAge: DAY * 7 }).send(result);
  });
});

function doLogin(username, password, cb) {
  if(!accounts[username] || (accounts[username] && accounts[username].password != password))
    return cb({ error: "EINVALID" });
  else if(accounts[username] && accounts[username].password == password) {
    var token = crypto.randomBytes(16).toString("base64");
    tokens[token] = { username: username, expiry: (new Date()).getTime() + (DAY * 7)};
    writeTokens();
    cb(null, { token: token });
  }
}

function writeAccounts() {
  fs.writeFileSync("accounts.json", JSON.stringify(accounts, null, "  "));
}

function writeTokens() {
  fs.writeFileSync("tokens.json", JSON.stringify(tokens, null, "  "));
}

function calculateStatus(key, cb) {
  var queued = checkIfInArr(queue, key);
  if(!queued) {
    var inProcessing = checkIfInArr(processing, key);
    if(!inProcessing) {
      var isProcessed = checkIfInArr(processed, key);
      if(!isProcessed) {
        return ({error: 404});
      } else {
      var tmp = buildStatusObj(isProcessed, "processed");
      return (tmp);
      }
    } else {
      var tmp = buildStatusObj(inProcessing, "processing");
      return (tmp);
    }
  } else {
    return ({status: "queued", position: getPosInQueue(key)});
  }
}

app.get("/watch/:key", function(req, res) {
  res.send(watchFile.replace("{{id}}", req.params.key));
})

function buildStatusObj(file, status) {
  var blocked = ["path"];
  var ret = {};
  for(key in file) {
    if(blocked.indexOf(key) == -1) {
      ret[key] = file[key];
    }
  }
  ret.status = status;
  return ret;
}

function getPosInQueue(key) {
  for(var i = 0 ; i < queue.length; i++) {
    if(queue[i].id == key) return i;
  }
  return -1;
}

function encode(data) {
  var formats = data.formats;
  activeThreads++;
  data.startedEncode = new Date().getTime();
  data.status = "processing";
  processing.push(data);
  var mp4 = false, webm = false, gif = false, audio = false;
  var done = {};
  for(var i = 0; i < formats.length; i++) {
    var format = formats[i];
    done[format] = false;
  }
  for(var i = 0; i < formats.length; i++) {
    (function(format) {
      encoders[format](data, pushUpdates, function() {
        done[format] = true;
        if(checkAllDone(done)) handleCleanup(data);
      });
    })(formats[i]);
  }
}

function checkAllDone(done) {
  for(key in done) {
    if(!done[key]) return false;
  }
  return true;
}

function queueForRetry(file) {
  if(file.retries < 5) {
    file.retries = file.retries || 0;
    file.retries++;
    setTimeout(function() {
      callback(file);
    }, 5 * 60 * 1000);
  }
}

function callback(file) {
  var url = file.callbackUrl;
  var cbregex = /(http[s]?:\/\/)([.\.]*)/gi;
  if(cbregex.test(url)) {
    var fd = {
      id: file.id
    }
    for(format in data.formats) {
      fd[key] = file.id + "." + key;
    }
    var opt = {
      url: url,
      formData: fd
    }
    request(opt, function(err, data, body) {
      if(err) queueForRetry(file);
    });
  }
}

function handleCleanup(file) {
  var id = file.id;
  try {
    fs.unlinkSync(file.path);
  } catch(e) {
    console.error("Couldn't remove temporary file!");
  }
  file.encodeComplete = new Date().getTime();
  activeThreads--;
  remove(processing, id);
  file.status = "processed";
  processed.push(file);
  pushUpdates(file.id, file);
  writeUploads();
  if(queue.length > 0) {
    var tmp = queue.shift();
    setImmediate(function() {
      encode(tmp);
    })
  }
}

app.use("/encoded", express.static("encoded/"));
app.use("/download", function(req, res, next) {
  res.set("Content-Type", "octet/stream");
  next();
}, express.static("encoded/"));


app.get("/view/:key", function(req, res) {
  res.send(viewFile.replace(/\{\{view\}\}/g, req.params.key));
});

function add(arr, data) {
  arr.push(data);
}

function remove(arr, key) {
  for(var i = 0 ; i < arr.length; i++) {
    if(arr[i].id === key) {
      return arr.splice(i, 1);
    }
  }
}

function checkIfInArr(arr, id) {
  for(var i = 0 ; arr && i < arr.length; i++) {
    if(arr[i].id == id)
      return arr[i];
  }
  return false;
}

function pruneExpired() {
  var now = new Date().getTime();
  var expiry = now - expiration["anonymous"];
  for(var i = 0 ; i < processed.length; i++) {
    var file = processed[i];
    if(file.encodeComplete <= expiry) {
      pruneFile(file);
      processed.splice(i--, 1);
    }
  }
  writeUploads();
}

app.get("/exists/:key", function(req, res) {
  var key = req.params.key;
  var exists = calculateStatus(key);
  res.send({exists: exists.error == undefined});
});

function pruneFile(file) {
  var base = "encoded/" + file.id;
  fs.unlink(base + ".mp4", function(err) {
    if(err && err.code != "ENOENT") console.error(err);
    fs.unlink(base + ".webm", function(err) {
      if(err && err.code != "ENOENT") console.error(err);
      fs.unlink(base + ".gif", function(err) {
        if(err && err.code != "ENOENT") console.error(err);
      })
    });
  })
}

function writeUploads() {
  fs.writeFileSync("uploads.json", JSON.stringify(processed, null, "  "));
}
