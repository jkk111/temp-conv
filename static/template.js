var currentId;
document.addEventListener("DOMContentLoaded", function() {
  document.body.addEventListener("dragover", cancel);
  document.body.addEventListener("dragenter", cancel);
  document.body.addEventListener("drop", handleFileDrop);
  registerFileUploadListener();
  if(window.location.hash) {
    var data = parseWindowHash();
    if(data.id) {
      currentId = data.id;
      checkExists(currentId, function(exists) {
        if(exists) registerSocket(data);
      });
    }
  }
});

function parseWindowHash(hash) {
  hash = hash || window.location.hash;
  if(hash.charAt(0) == "#") hash = hash.substring(1);
  var pairs = hash.split("&");
  var ret = {};
  for(var i = 0; i< pairs.length; i++) {
    var kv = pairs[i].split("=");
    if(ret[kv[0]]) console.warn("Duplicate param:", ret[0]);
    ret[kv[0]] = kv[1];
  }
  return ret;
}

function togglePreview() {
  var preview = document.getElementById("preview");
  var wrapper = document.getElementById("head");
  var video = document.getElementById("preview-video");
  if(preview.classList.contains("expanded")) {
    preview.classList.remove("expanded");
    window.location.hash = "";
    video.pause();
  }
  else {
    preview.classList.add("expanded");
  }
  setTimeout(hideProgress, 250);
}

function hideProgress() {
  var select = document.getElementById("file-sel");
  var encodeProgress = document.getElementById("encode-progress");
  var wrapper = document.getElementById("head");
  encodeProgress.classList.add("hidden");
  head.classList.remove("expanded");
  select.classList.remove("hidden");
}

function cancel(e) {
  if(e.preventDefault) e.preventDefault();
  return false;
}

function handleFileDrop(e) {
  if(e.preventDefault) e.preventDefault();
  if(e.stopPropagation) e.stopPropagation();
  var file = e.dataTransfer.files[0];
  console.log(e.type);
  uploadFile(file);
  return false;
}

function showProgress() {
  var select = document.getElementById("file-sel");
  var encodeProgress = document.getElementById("encode-progress");
  var wrapper = document.getElementById("head");
  encodeProgress.classList.remove("hidden");
  head.classList.add("expanded");
  select.classList.add("hidden");
}

function toggleProgress() {
  if(wrapper.classList.contains("expanded")) {
    hideProgress();
  } else {
    showProgress();
  }
}

function download(type) {
  if(!currentId || currentId == "") return;
  if(type.charAt(0) == ".") type = type.substring(1);
  var url = `/download/${currentId}.${type}`;
  window.location.href = url;
}

function registerSocket(res) {
  currentId = res.id;
  window.location.hash = "#id=" + res.id;
  showProgress();
  var tmp = document.getElementById("progress-tmp");
  var webm = document.getElementById("webmprogress");
  var gif = document.getElementById("gifprogress");
  var audio = document.getElementById("audioprogress");
  var mp4 = document.getElementById("mp4progress");
  var socket = io();
  socket.on("connect", function() {
    socket.emit("register", res.id);
  });
  socket.on("update", function(data) {
    tmp.innerHTML = JSON.stringify(data, null, "  ");
    seekProgress(audio, data.audioprogress);
    seekProgress(gif, data.gifprogress);
    seekProgress(mp4, data.mp4progress);
    seekProgress(webm, data.webmprogress);
    if(data.status == "processed") {
      var player = document.getElementById("preview-video");
      if(player.canPlayType("video/webm"))
        player.src = `encoded/${currentId}.webm`;
      else
        player.src = `encoded/${currentId}.mp4`;
      togglePreview();
    }
  });
}

function seekProgress(el, value) {
  value = value || 0;
  if(value == "complete") value = 100;
  if(el.transitioning)
    el.stopTransition();
  var diff = value - el.value;
  var decrement = diff < 0;
  if(Math.abs(diff) < 1 && Math.abs(diff) >= 0 ||
     Math.abs(diff) / 10 == 0) return el.value += diff;
  el.transitioning = true;
  var chunk = diff / 10;
  var i = 0;
  var interval = setInterval(function() {
    el.value += chunk;
    if(++i == 10) {
      el.transitioning = false;
      el.stopTransition = undefined;
      return clearInterval(interval);
    }
  }, 50);
  el.stopTransition = function() {
    clearInterval(interval);
    el.transitioning = false;
    el.stopTransition = undefined;
  }
  // Erratic behaviour, disabled temporarily
  // var seekTime = 10;
  // var curValue = el.value;
  // var diff = value - el.value;
  // if(diff == 0) return;
  // var positive = diff >= 0;
  // diff /= 10;
  // if(diff == 0) diff = 1 * (positive ? 1 : -1);
  // var seekInterval = setInterval(function() {
  //   var newValue;
  //   if(positive)
  //     newValue = Math.floor(Math.min((el.value + diff), value));
  //   else
  //     newValue = Math.floor(Math.max((el.value + diff), value));
  //   if(isFinite(newValue))
  //     el.value = newValue;
  //   if(el.value == value)
  //     clearInterval(seekInterval);
  // })
}

function checkExists(key, cb) {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "/exists/" + key, true);
  xhr.onload = function() {
    var body = JSON.parse(this.responseText);
    cb(body.exists || false);
  }
  xhr.send();
}

function uploadFile(file) {
  console.log("uploading file", file);
  var uploadProgress = document.getElementById("uploadprogress");
  toggleProgress();
  var form = new FormData();
  form.append("file", file);
  var xhr = new XMLHttpRequest();
  xhr.open("POST", "/upload", true);
  xhr.upload.onprogress = function(e) {
    if (e.lengthComputable) {
      var percentComplete = (e.loaded / e.total) * 100;
      uploadProgress.value = percentComplete;
    }
  }
  xhr.onload = function() {
    uploadProgress.value = 100;
    var res = JSON.parse(this.responseText);
    console.log("Listening to:", res);
    registerSocket(res);
  }
  xhr.send(form);
}

function registerFileUploadListener() {
  var select = document.getElementById("fileChooser");
  select.addEventListener("change", function(e) {
    if(this.value == "") return;
    var file = this.files[0];
    this.value = "";
    uploadFile(file);
  })
}