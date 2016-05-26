var ffmpeg = require("fluent-ffmpeg");
var fs = require("fs");
var pathIndex = process.argv.indexOf("-P");
if(pathIndex == -1) process.argv.indexOf("-p");
var removeConverted = process.argv.indexOf("-D");
if(removeConverted == -1) process.argv.indexOf("-d");
removeConverted = removeConverted != -1;
if(pathIndex != -1) pathIndex += 1;
var path = process.argv[pathIndex] || "./";
var resolve = require("path").resolve;
var items = fs.readdirSync(path);
// filter(items);
var expanded = (expandDir(path));
fs.writeFileSync("expanded.json", JSON.stringify(expanded, null, "  "), "utf8");

function filter() {
  var gifs = [];
  for(var i = 0; i < items.length; i++) {
    var item = items[i];
    var stats = fs.statSync()
    if(item.substring(item.length - 3) == "gif") {
      gifs.push(item);
    }
  }
  encode(gifs, gifs.length);
}

function expandDir(path) {
  if(path.charAt(path.length - 1) != "/")
    path += "/";
  var items = fs.readdirSync(path);
  for(var i = 0; i < items.length; i++) {
    var item = resolve(path, items[i]);
    console.log(`${i}/${items.length} ${item}`);
    var stats = fs.statSync(item);
    if(stats.isDirectory()) {
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
  setImmediate(function() {
    encodeItem(items, numItems);
  })
}

function encodeItem(items, numItems) {
  var item = items.shift();
  var filename = item.substring(item.lastIndexOf("/") + 1);
  ffmpeg(path + item).outputOptions("-c:v", "libvpx",
                             "-crf", "18",
                             "-b:v", "1000K",
                             "-cpu-used", "5")
  .save(path + item.substring(0, item.lastIndexOf(".")) + ".webm")
  .on("progress", function(progress) {
    updateStatus(items, numItems, false, filename);
  })
  .on("end", function() {
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