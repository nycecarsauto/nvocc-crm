/* Pure-JS Code128 (subset B) barcode -> SVG string. No dependencies. */
(function (global) {
  const PATTERNS = [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
    "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
    "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
    "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
    "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
    "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
    "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
    "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
    "114131","311141","411131","211412","211214","211232","2331112"
  ];
  const START_B = 104, STOP = 106;

  function encode(text) {
    text = String(text);
    const values = [START_B];
    for (let i = 0; i < text.length; i++) {
      let c = text.charCodeAt(i);
      if (c < 32 || c > 126) c = 32; // clamp to printable set B
      values.push(c - 32);
    }
    let sum = START_B;
    for (let i = 1; i < values.length; i++) sum += values[i] * i;
    values.push(sum % 103);   // checksum
    values.push(STOP);
    return values;
  }

  // Returns an <svg> string. opts: {moduleWidth, height, showText, fontSize}
  function toSVG(text, opts = {}) {
    const mw = opts.moduleWidth || 2;
    const height = opts.height || 60;
    const showText = opts.showText !== false;
    const fontSize = opts.fontSize || 12;
    const quiet = 10 * mw;
    const values = encode(text);
    let x = quiet;
    let rects = "";
    for (const v of values) {
      const pat = PATTERNS[v];
      let bar = true;
      for (const ch of pat) {
        const w = parseInt(ch, 10) * mw;
        if (bar) rects += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`;
        x += w; bar = !bar;
      }
    }
    const totalW = x + quiet;
    const svgH = height + (showText ? fontSize + 6 : 0);
    const label = showText
      ? `<text x="${totalW / 2}" y="${height + fontSize + 2}" font-family="monospace" font-size="${fontSize}" text-anchor="middle" fill="#000">${String(text).replace(/[<&>]/g, '')}</text>`
      : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${svgH}" viewBox="0 0 ${totalW} ${svgH}">`
      + `<rect width="${totalW}" height="${svgH}" fill="#fff"/>${rects}${label}</svg>`;
  }

  global.Code128 = { toSVG };
})(typeof window !== 'undefined' ? window : globalThis);
