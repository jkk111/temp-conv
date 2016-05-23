var currentId;
document.addEventListener("DOMContentLoaded", function() {
  registerFileUploadListener();
  if(window.location.hash) {
    var data = parseWindowHash();
    console.log(data);
    if(data.id) {
      currentId = data.id;
      registerSocket(data);
    }
  }
})

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
  if(preview.classList.contains("expanded")) {
    preview.classList.remove("expanded");
    window.location.hash = "";
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
  el.value = value;
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

function registerFileUploadListener() {
  var select = document.getElementById("fileChooser");
  var uploadProgress = document.getElementById("uploadprogress");
  select.addEventListener("change", function(e) {
    toggleProgress();
    var file = this.files[0];
    this.value = "";
    var form = new FormData();
    form.append("file", file);
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload", true);
    xhr.upload.onprogress = function(e) {
      if (e.lengthComputable) {
        var percentComplete = (e.loaded / e.total) * 100;
        uploadProgress.value = percentComplete;
        console.log(percentComplete + '% uploaded');
      }
    };
    xhr.onload = function() {
      uploadProgress.value = 100;
      var res = JSON.parse(this.responseText);
      console.log("Listening to:", res);
      registerSocket(res);
    }
    xhr.send(form);
  })
}