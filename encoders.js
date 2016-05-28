var ffmpeg = require("fluent-ffmpeg");

module.exports.FORMATS = ["WebM", "MP4", "Gif", "MP3"];

module.exports.WebM = encodeWebM;

module.exports.MP4 = encodeMP4;

module.exports.Gif = encodeGif;

module.exports.MP3 = encodeMP3;

function encodeMP4(file, pushUpdates, cb) {
  var path = file.path;
  file.mp4start = new Date().getTime();
  file.mp4progress = 0;
  pushUpdates(file.id, file);
  ffmpeg(path).outputOptions("-c:v", "libx264", "-preset", "ultrafast")
  .save(`encoded/${file.id}.mp4`)
  .on("error", function(err) {
    file.nomp4 = true;
    delete file.mp4start;
    pushUpdates(file.id, file);
    cb();
  })
  .on("progress", function(progress) {
    file.mp4progress = progress.percent;
    pushUpdates(file.id, file);
  })
  .on("end", function() {
    file.mp4progress = "complete";
    file.mp4end = new Date().getTime();
    pushUpdates(file.id, file);
    cb();
  });
}

function encodeWebM(file, pushUpdates, cb) {
  var path = file.path;
  file.webmstart = new Date().getTime();
  file.webmprogress = 0;
  pushUpdates(file.id, file);
  ffmpeg(path).outputOptions("-c:v", "libvpx",
                             "-crf", "18",
                             "-b:v", "1000K",
                             "-cpu-used", "5")
  .save(`encoded/${file.id}.webm`)
  .on("error", function(err) {
    file.nowebm = true;
    delete file.webmstart;
    pushUpdates(file.id, file);
    cb();
  })
  .on("progress", function(progress) {
    file.webmprogress = progress.percent;
    pushUpdates(file.id, file);
  })
  .on("end", function() {
    file.webmprogress = "complete"
    file.webmend = new Date().getTime();
    pushUpdates(file.id, file);
    cb();
  });
};

function encodeGif(file, pushUpdates, cb) {
  var path = file.path;
  file.gifstart = new Date().getTime();
  file.gifprogress = 0;
  pushUpdates(file.id, file);
  ffmpeg(path)
  .outputOptions("-pix_fmt", "rgb24")
  .save(`encoded/${file.id}.gif`)
  .on("error", function(err) {
    file.nogif = true;
    delete file.gifstart;
    pushUpdates(file.id, file);
    cb();
  })
  .on("progress", function(progress) {
    file.gifprogress = progress.percent;
    pushUpdates(file.id, file);
  })
  .on("end", function() {
    file.gifprogress = "complete";
    file.gifend = new Date().getTime();
    pushUpdates(file.id, file);
    cb();
  });
};

function encodeMP3(file, pushUpdates, cb) {
  var path = file.path;
  file.mp3start = new Date().getTime();
  file.mp3progress = 0;
  pushUpdates(file.id, file);
  ffmpeg(path).outputOptions("-ab", "160k", "-ac", "2", "-ar", "44100", "-vn")
  .save(`encoded/${file.id}.mp3`)
  .on("error", function(err) {
    file.nomp3 = true;
    delete file.mp3start;
    pushUpdates(file.id, file);
    cb();
  })
  .on("progress", function(progress) {
    file.mp3progress = progress.percent;
    pushUpdates(file.id, file);
  })
  .on("end", function() {
    file.mp3progress = "complete";
    file.mp3end = new Date().getTime();
    pushUpdates(file.id, file);
    cb();
  })
};