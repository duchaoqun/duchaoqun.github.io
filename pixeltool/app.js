/* =======================================================
   PixelTool 应用层 —— 功能界面版
   新控件：文件信息 + 更换按钮、调色板网格、数字按钮组、
         最大颜色数滑块、输出尺寸下拉、图片信息行
   ======================================================= */

(function () {

  var uploadedImage = null;
  var pixelResult = null;
  var debounceTimer = null;

  /* ------- DOM 引用 ------- */
  var uploadArea   = document.getElementById('uploadArea');
  var fileInput    = document.getElementById('fileInput');

  var fileInfo     = document.getElementById('fileInfo');
  var fileName     = document.getElementById('fileName');
  var fileSize     = document.getElementById('fileSize');
  var btnReplace   = document.getElementById('btnReplace');

  var sizeGroup    = document.getElementById('sizeGroup');
  var sliderSize   = document.getElementById('sliderSize');
  var valueSize    = document.getElementById('valueSize');

  var paletteSection = document.getElementById('paletteSection');
  var paletteCards   = document.querySelectorAll('.palette-card');
  var currentPalette = 'auto';

  var numgroup     = document.getElementById('numgroup');
  var numBtns      = document.querySelectorAll('.num-btn');
  var currentCount = 8;

  var maxcolorsGroup = document.getElementById('maxcolorsGroup');
  var sliderMaxColors = document.getElementById('sliderMaxColors');
  var valueMaxColors = document.getElementById('valueMaxColors');

  var sizeLimitGroup = document.getElementById('sizeLimitGroup');
  var outputSize     = document.getElementById('outputSize');

  var previewInner = document.getElementById('previewInner');
  var previewFooter = document.getElementById('previewFooter');
  var btnPNG       = document.getElementById('btnPNG');
  var btnSVG       = document.getElementById('btnSVG');
  var imageInfo    = document.getElementById('imageInfo');

  var toast        = document.getElementById('toast');

  /* =======================================================
     上传 + 更换
     ======================================================= */
  uploadArea.addEventListener('click', function () { fileInput.click(); });
  uploadArea.addEventListener('dragover', function (e) {
    e.preventDefault(); uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', function () { uploadArea.classList.remove('drag-over'); });
  uploadArea.addEventListener('drop', function (e) {
    e.preventDefault(); uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });
  btnReplace.addEventListener('click', function () { fileInput.click(); });

  function handleFile(file) {
    if (!file.type.startsWith('image/')) { showToast('请选择图片文件'); return; }
    if (file.size > 30 * 1024 * 1024) { showToast('图片不能超过 30MB'); return; }
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        uploadedImage = img;
        fileName.textContent = truncate(file.name, 20);
        fileSize.textContent = img.width + ' × ' + img.height + ' px';

        uploadArea.style.display = 'none';
        fileInfo.style.display = 'flex';
        sizeGroup.style.display = 'block';
        paletteSection.style.display = 'block';
        numgroup.style.display = 'block';
        maxcolorsGroup.style.display = 'block';
        sizeLimitGroup.style.display = 'block';
        previewFooter.style.display = 'flex';

        runPixelate();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* =======================================================
     调色板网格切换
     ======================================================= */
  paletteCards.forEach(function (card) {
    card.addEventListener('click', function () {
      paletteCards.forEach(function (c) { c.classList.remove('active'); });
      card.classList.add('active');
      currentPalette = card.dataset.palette;
      runPixelate();
    });
  });

  /* =======================================================
     数字按钮组 (取色数量)
     ======================================================= */
  numBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      numBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentCount = parseInt(btn.dataset.count, 10);
      runPixelate();
    });
  });

  /* =======================================================
     滑块
     ======================================================= */
  sliderSize.addEventListener('input', function () {
    valueSize.textContent = sliderSize.value;
    debounceRun();
  });

  sliderMaxColors.addEventListener('input', function () {
    var v = parseInt(sliderMaxColors.value, 10);
    valueMaxColors.textContent = v >= 256 ? '原色' : v;
    debounceRun();
  });

  outputSize.addEventListener('change', function () { debounceRun(); });

  function debounceRun() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runPixelate, 60);
  }

  /* =======================================================
     核心：像素化 + 渲染
     ======================================================= */
  function runPixelate() {
    if (!uploadedImage) return;

    var pixelSize = parseInt(sliderSize.value, 10);
    var maxColors = parseInt(sliderMaxColors.value, 10);

    // 确定使用多少颜色 —— 预设调色板用固定数量，否则用 maxColors 或数字组
    var colorCount;
    var fixedPalette = null;

    if (currentPalette === 'fromimage' || currentPalette === 'auto') {
      // 自动取色：用数字按钮指定的颜色数
      colorCount = currentCount;
    } else {
      // 预设调色板：数量取该调色板长度
      fixedPalette = PALETTES[currentPalette];
      colorCount = fixedPalette ? fixedPalette.length : currentCount;
    }

    pixelResult = Pixelator.pixelate(uploadedImage, pixelSize, colorCount, fixedPalette);
    renderPreview();
    updateImageInfo();
  }

  function renderPreview() {
    var c = pixelResult.canvas;
    previewInner.innerHTML = '';
    c.style.display = 'block';

    // 始终把像素化 canvas 放大/缩小填满预览框
    // 这样 pixelSize 滑块只改变色块数量，不改变预览整体显示大小
    var boxW = previewInner.clientWidth || 720;
    var boxH = previewInner.clientHeight || 430;
    var scale = Math.min(boxW / c.width, boxH / c.height);
    c.style.width = (c.width * scale) + 'px';
    c.style.height = (c.height * scale) + 'px';

    previewInner.appendChild(c);
  }

  function updateImageInfo() {
    if (!pixelResult) { imageInfo.textContent = '—'; return; }
    var w = pixelResult.pixelWidth;
    var h = pixelResult.pixelHeight;
    var total = w * h;
    var colorsShown;
    if (currentPalette === 'fromimage' || currentPalette === 'auto') {
      colorsShown = currentCount + ' 色';
    } else {
      colorsShown = PALETTES[currentPalette] ? PALETTES[currentPalette].length + ' 色' : '原色';
    }
    imageInfo.textContent = w + ' × ' + h + ' · ' + total.toLocaleString() + ' px · ' + colorsShown;
  }

  /* =======================================================
     导出按钮
     ======================================================= */
  btnPNG.addEventListener('click', function () {
    if (!pixelResult) { showToast('请先上传图片'); return; }
    var scale = parseInt(outputSize.value, 10) || 0;
    var scaleArg = scale > 0 ? scale : undefined;
    Pixelator.exportPNG(pixelResult, 'pixelart_' + sliderSize.value + 'px.png', scaleArg);
    showToast('PNG 已导出 ✨');
  });

  btnSVG.addEventListener('click', function () {
    if (!pixelResult) { showToast('请先上传图片'); return; }
    Pixelator.exportSVG(pixelResult.canvas, 'pixelart_' + sliderSize.value + 'px.svg');
    showToast('SVG 已导出 ✨');
  });

  /* =======================================================
     FAQ 手风琴
     ======================================================= */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    item.querySelector('.faq-q').addEventListener('click', function () {
      item.classList.toggle('open');
    });
  });

  /* =======================================================
     调色板条渲染（初始化卡片上的颜色渐变）
     ======================================================= */
  // CSS 已用 background-image 做渐变条，无需额外渲染

  /* =======================================================
     提示条
     ======================================================= */
  var toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2000);
  }

})();
