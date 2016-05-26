var ffmpeg = require("fluent-ffmpeg");
var fs = require("fs");
var mime = require("mime");
var verbose = process.argv.indexOf("-V");
if(verbose == -1) verbose = process.argv.indexOf("-v");
verbose = verbose != -1;
var pathIndex = process.argv.indexOf("-P");
if(pathIndex == -1) pathIndex = process.argv.indexOf("-p");
var removeConverted = process.argv.indexOf("-D");
if(removeConverted == -1) removeConverted = process.argv.indexOf("-d");
var recursive = process.argv.indexOf("-R");
if(recursive == -1) recursive = process.argv.indexOf("-r");
recursive = recursive != -1;
removeConverted = removeConverted != -1;
if(pathIndex != -1) pathIndex += 1;
var path = process.argv[pathIndex] || process.cwd();
if(verbose)
  console.info("Path:", path);
var resolve = require("path").resolve;
var items = fs.readdirSync(path);
// filter(items);
var expanded = filter(expandDir(path));
encode(expanded);
fs.writeFileSync("./expanded.json", JSON.stringify(expanded, null, "  "), "utf8");
console.info("Found %d gifs", expanded.length);
console.info(expanded)
function filter(items) {
  console.info("Starting to filter gifs");
  var gifs = [];
  for(var i = 0; i < items.length; i++) {
    var item = items[i];
    var stats = fs.statSync(item);
    if(mime.lookup(item) == "image/gif" && !stats.isDirectory()) {
      gifs.push(item);
    }
  }
  return gifs;
}

function expandDir(path) {
  if(path.charAt(path.length - 1) != "/")
    path += "/";
  var items = fs.readdirSync(path);
  for(var i = 0; i < items.length; i++) {
    var item = resolve(path, items[i]);
    if(verbose)
      console.log(`${i}/${items.length} ${item}`);
    var stats = fs.statSync(item);
    if(recursive && stats.isDirectory()) {
      var tmp = expandDir(item);
      for(var j = 0; j < tmp.length; j++) {
        tmp[j] = resolve(item, tmp[j]);
        if(items.indexOf(tmp[j]) == -1) items.push(tmp[j])
      }
    }
  }
  return items;
}

function encode(items, numItems) {
  if(items.length == 0) return updateStatus(items, numItems, true);
  if(numItems == undefined) numItems = items.length;
  setImmediate(function() {
    encodeItem(items, numItems);
  });
}

function encodeItem(items, numItems) {
  var item = items.shift();
  var filename = item.substring(item.lastIndexOf("/") + 1);
  if(verbose) console.info("Starting to convert: %s", filename);
  ffmpeg(item).outputOptions("-c:v", "libvpx",
                             "-crf", "18",
                             "-b:v", "1000K",
                             "-cpu-used", "5")
  .save(path + item.substring(0, item.lastIndexOf(".")) + ".webm")
  .on("progress", function(progress) {
    updateStatus(items, numItems, false, filename);
  })
  .on("end", function() {
    if(removeConverted) fs.unlinkSync(item);
    if(verbose) {
      console.info("finished converting: %s", filename);
      if(removeConverted) console.info("Removed: %s", filename);
    }
    updateStatus(items, numItems, false, filename);
    encode(items, numItems);
  });
}

function updateStatus(items, num, finished, name) {
  if(!finished) {
    var complete = num - (items.length + 1);
    var completePercent = (complete / num) * 100;
    console.log(`${completePercent.toFixed()}% ${complete}\\${num} (${name})`);
  } else {
    console.log("100% " + num + "\\" + num);
  }
}