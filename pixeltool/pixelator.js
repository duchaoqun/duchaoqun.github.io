/* =======================================================
   Pixelator — 图片像素化引擎
   功能：降采样 + 颜色量化（中位切分）+ PNG/SVG 导出
   所有处理在浏览器本地完成，不上传服务器
   ======================================================= */

var Pixelator = (function () {

  /* ------- 主入口：像素化一张图 ------- */
  // 参数：image (HTMLImageElement)、pixelSize (1-100)、colorCount (2-256)
  //       optional palette: 固定调色板数组 [[r,g,b], ...]；或 null 自动取色
  function pixelate(image, pixelSize, colorCount, fixedPalette) {
    pixelSize = Math.max(1, Math.floor(pixelSize));

    // 1. 降采样到小尺寸
    var smallW = Math.max(1, Math.floor(image.width / pixelSize));
    var smallH = Math.max(1, Math.floor(image.height / pixelSize));
    var smallCanvas = document.createElement('canvas');
    smallCanvas.width = smallW; smallCanvas.height = smallH;
    var sctx = smallCanvas.getContext('2d');
    sctx.drawImage(image, 0, 0, smallW, smallH);

    // 2. 读取所有像素颜色
    var imgData = sctx.getImageData(0, 0, smallW, smallH);
    var pixels = [];
    for (var i = 0; i < imgData.data.length; i += 4) {
      pixels.push([imgData.data[i], imgData.data[i + 1], imgData.data[i + 2], imgData.data[i + 3]]);
    }

    // 3. 确定调色板
    var palette;
    if (fixedPalette && fixedPalette.length >= 2) {
      // 使用预设调色板，直接映射
      palette = fixedPalette;
    } else if (colorCount >= 256) {
      palette = null;
    } else {
      var validColors = pixels.filter(function (p) { return p[3] > 128; }).map(function (p) { return [p[0], p[1], p[2]]; });
      if (validColors.length === 0) validColors = pixels.map(function (p) { return [p[0], p[1], p[2]]; });
      palette = medianCut(validColors, colorCount);
    }

    // 4. 把每个像素映射到调色板最近的颜色
    var remapped = new Uint8ClampedArray(imgData.data.length);
    for (var j = 0; j < pixels.length; j++) {
      var p = pixels[j];
      var r, g, b;
      if (!palette) {
        r = p[0]; g = p[1]; b = p[2];
      } else {
        var nearest = findNearestColor(palette, p[0], p[1], p[2]);
        r = palette[nearest][0];
        g = palette[nearest][1];
        b = palette[nearest][2];
      }
      remapped[j * 4] = r;
      remapped[j * 4 + 1] = g;
      remapped[j * 4 + 2] = b;
      remapped[j * 4 + 3] = p[3];
    }
    sctx.putImageData(new ImageData(remapped, smallW, smallH), 0, 0);

    // 5. 放大回原始尺寸（nearest-neighbor 保持像素锐利）
    var outCanvas = document.createElement('canvas');
    outCanvas.width = smallW;
    outCanvas.height = smallH;
    outCanvas.getContext('2d').putImageData(new ImageData(remapped, smallW, smallH), 0, 0);

    return {
      canvas: outCanvas,
      palette: palette,
      pixelWidth: smallW,
      pixelHeight: smallH,
      pixelSize: pixelSize,
      originalWidth: image.width,
      originalHeight: image.height
    };
  }

  /* ------- 中位切分 (Median Cut) 颜色量化 ------- */
  function medianCut(colors, k) {
    if (!colors || colors.length === 0) return [[128, 128, 128]];
    if (colors.length <= k) return colors.map(function (c) { return c.slice(); });

    // 初始桶
    var buckets = [colors.slice()];

    while (buckets.length < k) {
      // 找到颜色范围最大的桶，沿最大范围轴中位数切分
      var maxIdx = 0;
      var maxRange = -1;
      for (var i = 0; i < buckets.length; i++) {
        if (buckets[i].length < 2) continue;
        var range = bucketRange(buckets[i]);
        if (range.total > maxRange) {
          maxRange = range.total;
          maxIdx = i;
        }
      }
      if (maxRange <= 0) break;

      var bucket = buckets[maxIdx];
      var ranges = bucketRange(bucket);
      var axis = ranges.maxAxis; // 0=R, 1=G, 2=B
      bucket.sort(function (a, b) { return a[axis] - b[axis]; });

      var mid = Math.floor(bucket.length / 2);
      buckets.splice(maxIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    // 每个桶取平均色
    return buckets.map(function (bucket) {
      var r = 0, g = 0, b = 0;
      for (var i = 0; i < bucket.length; i++) {
        r += bucket[i][0]; g += bucket[i][1]; b += bucket[i][2];
      }
      var n = bucket.length || 1;
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    });
  }

  function bucketRange(bucket) {
    var min = [255, 255, 255];
    var max = [0, 0, 0];
    for (var i = 0; i < bucket.length; i++) {
      for (var c = 0; c < 3; c++) {
        if (bucket[i][c] < min[c]) min[c] = bucket[i][c];
        if (bucket[i][c] > max[c]) max[c] = bucket[i][c];
      }
    }
    var ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    var axis = 0;
    if (ranges[1] > ranges[axis]) axis = 1;
    if (ranges[2] > ranges[axis]) axis = 2;
    return { total: ranges[0] + ranges[1] + ranges[2], maxAxis: axis };
  }

  /* ------- 找最近颜色 ------- */
  function findNearestColor(palette, r, g, b) {
    var minDist = Infinity;
    var idx = 0;
    for (var i = 0; i < palette.length; i++) {
      var dr = r - palette[i][0];
      var dg = g - palette[i][1];
      var db = b - palette[i][2];
      var d = dr * dr + dg * dg + db * db;
      if (d < minDist) { minDist = d; idx = i; }
    }
    return idx;
  }

  /* ------- 导出 PNG（放大到合理尺寸，保持像素锐利） ------- */
  function exportPNG(result, filename, scale) {
    filename = filename || 'pixelart.png';
    // scale 是每个逻辑像素的放大倍数；默认匹配原始图像尺寸
    scale = scale || Math.max(1, Math.round(result.originalWidth / result.pixelWidth));
    var w = result.pixelWidth * scale;
    var h = result.pixelHeight * scale;

    var big = document.createElement('canvas');
    big.width = w; big.height = h;
    var bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = false; // nearest-neighbor
    bctx.drawImage(result.canvas, 0, 0, w, h);

    big.toBlob(function (blob) {
      downloadBlob(blob, filename);
    }, 'image/png');
  }

  /* ------- 导出 SVG ------- */
  // 把像素网格写成 SVG 矩形网格（每个像素一个 <rect>）
  function exportSVG(canvas, filename) {
    filename = filename || 'pixelart.svg';
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d');
    var imgData = ctx.getImageData(0, 0, w, h).data;

    var rects = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var r = imgData[i], g = imgData[i + 1], b = imgData[i + 2], a = imgData[i + 3];
        if (a < 16) continue;
        var hex = rgbToHex(r, g, b);
        var alpha = (a / 255).toFixed(2);
        rects.push('<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + hex + '"' +
          (a < 255 ? ' opacity="' + alpha + '"' : '') + '/>');
      }
    }

    var svg = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      rects.join('') + '</svg>';

    var blob = new Blob([svg], { type: 'image/svg+xml' });
    downloadBlob(blob, filename);
  }

  function rgbToHex(r, g, b) {
    var hx = function (v) { return ('0' + v.toString(16)).slice(-2); };
    return '#' + hx(r) + hx(g) + hx(b);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 100);
  }

  return {
    pixelate: pixelate,
    exportPNG: exportPNG,
    exportSVG: exportSVG
  };

})();
