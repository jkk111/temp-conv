var express = require("express");
var queue = [];
var processing = [];
var processed = [];
var app = express();
var multer = require("multer");
var storage = multer.diskStorage({});
var upload = multer({storage: storage});
var ffmpeg = require("fluent-ffmpeg");
var encoders = require("./encoders.js");
var https = require("https");
var fs = require("fs");
var viewFile = fs.readFileSync("static/view.html", "utf8");
var watchFile = fs.readFileSync("static/watch.html", "utf8");
const MAX_THREADS = 4;
var activeThreads = 0;
var MAX_AGE = 60 * 60 * 1000;
var server;

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

// Accepts upload and sends the user a key to check the file.
app.post("/upload", upload.single("file"), function(req, res) {
  if(req.file && (req.file.mimetype.indexOf("video") != -1 || req.file.mimetype == "image/gif")) {
    var data = {
      filename: req.file.originalname,
      path: req.file.path,
      id: req.file.filename,
      added: new Date().getTime()
    }
    if(activeThreads < MAX_THREADS)
      encode(data);
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
})

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
  activeThreads++;
  data.startedEncode = new Date().getTime();
  data.status = "processing";
  processing.push(data);
  var mp4 = false, webm = false, gif = false, audio = false;
  var done = {};
  for(var i = 0; i < encoders.FORMATS.length; i++) {
    var format = encoders.FORMATS[i];
    done[format] = false;
  }
  for(var i = 0; i < encoders.FORMATS.length; i++) {
    (function(format) {
      encoders[format](data, pushUpdates, function() {
        done[format] = true;
        if(checkAllDone(done)) handleCleanup(data);
      });
    })(encoders.FORMATS[i]);
  }
}

function checkAllDone(done) {
  for(key in done) {
    if(!done[key]) return false;
  }
  return true;
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
  var expiry = now - MAX_AGE;
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
    if(err) console.error(err);
    fs.unlink(base + ".webm", function(err) {
      if(err) console.error(err);
      fs.unlink(base + ".gif", function(err) {
        if(err) console.error(err);
      })
    });
  })
}

function writeUploads() {
  fs.writeFileSync("uploads.json", JSON.stringify(processed, null, "  "));
}