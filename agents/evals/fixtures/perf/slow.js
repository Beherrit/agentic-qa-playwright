// Planted: a render-blocking script (the server answers it 1.5 s late) that then holds the main thread.
// Lighthouse should report it under render-blocking-resources and count the busy loop towards TBT.
(function () {
  var until = Date.now() + 600;
  var n = 0;
  while (Date.now() < until) n += 1;
  window.__plantedSpin = n;
})();
