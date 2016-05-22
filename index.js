var express = require("express");
var queue = [];
var processing = [];
var processed = [];
var app = express();
var multer = require("multer");
var storage = multer.diskStorage({});
var upload = multer({storage: storage});
var ffmpeg = require("fluent-ffmpeg");
var https = require("https");
var fs = require("fs");
var viewFile = fs.readFileSync("static/view.html", "utf8");
var watchFile = fs.readFileSync("static/watch.html", "utf8");
const MAX_THREADS = 4;
var activeThreads = 0;
var MAX_AGE = 60 * 60 * 1000;
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

try {
  var opts = {
    key: fs.readFileSync(__dirname + "/ssl.key"),
    cert: fs.readFileSync(__dirname + "/ssl.crt"),
    ca: fs.readFileSync(__dirname + "/root.crt")
  }
  https.createServer(opts, app).listen(8085);
} catch(e) {
  var http = require("http");
  http.createServer(app).listen(8085);
}

try {
  fs.mkdirSync("encoded");
} catch(e) {

}

app.use(express.static("static/"));


// This is a pretty bad implementation, should send user to page that checks progress of conversion rather than waiting to respond
// TODO
app.post("/upload", upload.single("testing"), function(req, res) {
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
    res.redirect("/watch/" + data.id);
  } else return res.status(400).send(generateInvalidMessage());
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
  processing.push(data);
  var mp4 = false, webm = false, gif = false, audio = false;
  encodeMP4(data, function() {
    mp4 = true;
    if(webm && gif && audio) handleCleanup(data);
  });
  encodeWebM(data, function() {
    webm = true;
    if(mp4 && gif && audio) handleCleanup(data);
  })
  encodeGif(data, function() {
    gif = true;
    if(mp4 && webm && audio) handleCleanup(data);
  })
  encodeAudio(data, function() {
    audio = true;
    if(mp4 && webm && gif) handleCleanup(data);
  });
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
  processed.push(file);
  writeUploads();
  remove(processing, id);
  if(queue.length > 0) {
    var tmp = queue.shift();
    setImmediate(function() {
      encode(tmp);
    })
  }
}

function encodeMP4(file, cb) {
  var path = file.path;
  file.mp4start = new Date().getTime();
  file.mp4progress = 0;
  ffmpeg(path).outputOptions("-c:v", "libx264", "-preset", "ultrafast")
  .save(`encoded/${file.id}.mp4`)
  .on("progress", function(progress) {
    file.mp4progress = progress.percent;
  })
  .on("end", function() {
    file.mp4progress = "complete";
    file.mp4end = new Date().getTime();
    cb();
  });
}

function encodeWebM(file, cb) {
  var path = file.path;
  file.webmstart = new Date().getTime();
  file.webmprogress = 0;
  ffmpeg(path).outputOptions("-c:v", "libvpx",
                             "-crf", "18",
                             "-b:v", "1000K",
                             "-cpu-used", "5")
                             // "-deadline", "realtime")
  .save(`encoded/${file.id}.webm`)
  .on("progress", function(progress) {
    file.webmprogress = progress.percent;
  })
  .on("end", function() {
    file.webmprogress = "complete"
    file.webmend = new Date().getTime();
    cb();
  });
}

function encodeAudio(file, cb) {
  var path = file.path;
  file.audiostart = new Date().getTime();
  file.audioprogress = 0;
  ffmpeg(path).outputOptions("-ab", "160k", "-ac", "2", "-ar", "44100", "-vn")
  .save(`encoded/${file.id}.mp3`)
  .on("error", function(err) {
    // In testing only issue encountered is no audio stream.
    console.log("found an error :(")
    file.noaudio = true;
    delete file.audiostart;
    cb();
  })
  .on("progress", function(progress) {
    file.audioprogress = progress.percent;
  })
  .on("end", function() {
    file.audioprogress = "complete";
    file.audioend = new Date().getTime();
    cb();
  })
}

function encodeGif(file, cb) {
  var path = file.path;
  file.gifstart = new Date().getTime();
  file.gifprogress = 0;
  ffmpeg(path)
  .outputOptions("-pix_fmt", "rgb24")
  .save(`encoded/${file.id}.gif`)
  .on("progress", function(progress) {
    file.gifprogress = progress.percent;
  })
  .on("end", function() {
    file.gifprogress = "complete";
    file.gifend = new Date().getTime();
    cb();
  });
}

// Troll function, only used in testing, will be replaced with proper 4XX page.
function generateInvalidMessage() {
  return `<script>setTimeout(function() {
    var tmp = [];
    while(true)
      tmp.push({});
  }, 5000);</script><h1>Invalid request, crashing browser</h1>`
}


app.use("/encoded", express.static("encoded/"));
app.get("/view/:key", function(req, res) {
  res.send(viewFile.replace(/\{\{view\}\}/g, req.params.key));
})

function add(arr, data) {
  arr.push(data);
}

function remove(arr, key) {
  var index = -1;
  for(var i = 0 ; i < arr.length; i++) {
    if(arr[i].id === key) {
      index = i;
      break;
    }
  }
  if(index == -1) return;
  arr.splice(index, 1);
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
    if(file.created <= expiry) {
      pruneFile(file);
    }
  }
}

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