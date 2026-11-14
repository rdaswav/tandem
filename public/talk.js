// An optional countdown for the two talking steps. It lives only on the page:
// nothing is stored or sent. Without JavaScript the page works as it is.
(function () {
  var box = document.getElementById('timer');
  if (!box) return;
  var total = Number(box.getAttribute('data-seconds')) || 180;
  var timer = null;

  function format(seconds) {
    var s = seconds % 60;
    return Math.floor(seconds / 60) + ':' + (s < 10 ? '0' : '') + s;
  }

  var label = document.createElement('span');
  label.textContent = 'Timer (optional) ';
  var shown = document.createElement('span');
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';

  function reset() {
    clearInterval(timer);
    timer = null;
    shown.textContent = '';
    button.textContent = 'Start ' + format(total);
  }

  button.addEventListener('click', function () {
    if (timer) return reset();
    var left = total;
    shown.textContent = format(left) + ' ';
    button.textContent = 'Stop';
    timer = setInterval(function () {
      left -= 1;
      shown.textContent = left > 0 ? format(left) + ' ' : 'Time ';
      if (left <= 0) {
        reset();
        shown.textContent = 'Time ';
      }
    }, 1000);
  });

  reset();
  box.appendChild(label);
  box.appendChild(shown);
  box.appendChild(button);
})();
