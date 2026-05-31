(() => {
  "use strict";

  const data = JSON.parse(document.getElementById("plot-data").textContent);
  const graph = document.getElementById("graph");
  const svg = document.getElementById("plot");
  const select = document.getElementById("pairSelect");
  const legend = document.getElementById("legend");
  const tooltip = document.getElementById("tooltip");
  const meta = document.getElementById("meta");
  const modebar = document.getElementById("modebar");
  const resetButton = document.getElementById("resetButton");
  const ns = "http://www.w3.org/2000/svg";
  const hiddenPops = new Set();
  const selectedSamples = new Set();
  const groupLabelOffsets = new Map();
  const markerScales = [1, 1.35, 0.75];
  const hullOpacityValues = [0.18, 0.34, 0.08];
  let activeTool = "pan";
  let clickTimer = 0;
  let resizeTimer = 0;
  let currentPair = data.startPair;
  let view = null;
  let frame = null;
  let drag = null;
  let labelDrag = null;
  let selectionRect = null;
  let lassoPoints = [];
  let spikePoint = null;
  let subtitle = "";
  let legendVisible = true;
  let hoverEnabled = true;
  let grayMode = false;
  let labelMode = 0;
  let markerScaleIndex = 0;
  let squarePlot = false;
  let groupLabels = false;
  let groupLabelStyle = 0;
  let hullsVisible = false;
  let hullOpacityIndex = 0;
  let regressionVisible = false;
  let spikesVisible = false;

  function el(name, attrs = {}, text = null) {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, String(value));
    }
    if (text !== null) {
      node.textContent = text;
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function sampleKey(sample) {
    return `${sample.pop}\u0000${sample.sample}`;
  }

  function groupLabelKey(pop) {
    return `${currentPair}\u0000${pop}`;
  }

  function visiblePops() {
    return data.pops.filter((pop) => !hiddenPops.has(pop));
  }

  function visibleSamples() {
    return data.samples.filter((sample) => !hiddenPops.has(sample.pop));
  }

  function currentPairInfo() {
    return data.pairs.find((item) => item.key === currentPair) || data.pairs[0];
  }

  function pairLimits(pairKey = currentPair) {
    const limits = data.limits[pairKey];
    return {
      xMin: limits.x[0],
      xMax: limits.x[1],
      yMin: limits.y[0],
      yMax: limits.y[1],
    };
  }

  function setViewToPair(pairKey = currentPair) {
    view = pairLimits(pairKey);
  }

  function axisLimits(values) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.abs(hi - lo) < 1e-12 ? Math.max(Math.abs(lo) * 0.05, 0.01) : (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }

  function updateMeta() {
    const shown = visiblePops().length;
    meta.textContent = `${data.evecName} - ${data.samples.length} samples - ${shown}/${data.pops.length} populations shown`;
  }

  function formatTick(value) {
    if (Math.abs(value) < 1e-12) {
      return "0";
    }
    const abs = Math.abs(value);
    if (abs < 0.001 || abs >= 1000) {
      return value.toExponential(2);
    }
    return Number(value.toPrecision(4)).toString();
  }

  function clamp(value, min, max) {
    if (min > max) {
      return (min + max) / 2;
    }
    return Math.max(min, Math.min(max, value));
  }

  function estimateTextWidth(text, fontSize = 11) {
    let width = 0;
    for (const char of text) {
      if (char === " ") {
        width += fontSize * 0.35;
      } else if ("._-:()".includes(char)) {
        width += fontSize * 0.38;
      } else if (char >= "A" && char <= "Z") {
        width += fontSize * 0.68;
      } else if (char >= "0" && char <= "9") {
        width += fontSize * 0.58;
      } else {
        width += fontSize * 0.54;
      }
    }
    return Math.ceil(width);
  }

  function niceTicks(min, max, count = 7) {
    const span = max - min;
    if (!(span > 0)) {
      return [min];
    }
    const rawStep = span / Math.max(1, count - 1);
    const exponent = Math.floor(Math.log10(rawStep));
    const base = 10 ** exponent;
    const fraction = rawStep / base;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    const step = niceFraction * base;
    const start = Math.ceil(min / step) * step;
    const end = Math.floor(max / step) * step;
    const ticks = [];
    for (let value = start; value <= end + step * 0.5; value += step) {
      ticks.push(Number(value.toPrecision(12)));
    }
    if (ticks.length === 0) {
      ticks.push(min, max);
    }
    return ticks;
  }

  function colorForPop(pop) {
    return grayMode ? "#b8b8b8" : data.styles[pop].color;
  }

  function markerSize() {
    return data.pointSize * markerScales[markerScaleIndex];
  }

  function isMobileLayout() {
    return window.matchMedia("(max-width: 760px)").matches;
  }

  function layoutFrame(width, height) {
    const legendWidth = legendVisible && !isMobileLayout() ? Math.min(300, legend.offsetWidth + 34) : 0;
    const baseMargin = { left: 72, right: 28 + legendWidth, top: 50, bottom: 62 };
    const availableWidth = Math.max(80, width - baseMargin.left - baseMargin.right);
    const availableHeight = Math.max(80, height - baseMargin.top - baseMargin.bottom);

    if (!squarePlot) {
      const margin = baseMargin;
      return {
        width,
        height,
        margin,
        innerWidth: availableWidth,
        innerHeight: availableHeight,
        plotRight: margin.left + availableWidth,
        plotBottom: margin.top + availableHeight,
      };
    }

    const size = Math.min(availableWidth, availableHeight);
    const extraX = Math.max(0, (availableWidth - size) / 2);
    const extraY = Math.max(0, (availableHeight - size) / 2);
    const margin = {
      left: baseMargin.left + extraX,
      right: baseMargin.right + extraX,
      top: baseMargin.top + extraY,
      bottom: baseMargin.bottom + extraY,
    };
    return {
      width,
      height,
      margin,
      innerWidth: size,
      innerHeight: size,
      plotRight: margin.left + size,
      plotBottom: margin.top + size,
    };
  }

  function positionLegend() {
    if (!frame || isMobileLayout()) {
      legend.style.top = "";
      legend.style.right = "";
      legend.style.bottom = "";
      legend.style.left = "";
      legend.style.maxHeight = "";
      return;
    }
    legend.style.top = `${frame.margin.top}px`;
    legend.style.left = `${clamp(frame.plotRight + 16, 8, frame.width - legend.offsetWidth - 8)}px`;
    legend.style.right = "";
    legend.style.bottom = "";
    legend.style.maxHeight = `calc(100% - ${frame.margin.top + 16}px)`;
  }

  function defaultGroupLabelOffset(index) {
    const angle = -Math.PI / 3 + index * 2.399963229728653;
    return {
      dx: Math.cos(angle) * 54,
      dy: Math.sin(angle) * 34,
    };
  }

  function labelLineEnd(centroid, label, width, height) {
    const dx = label.x - centroid.x;
    const dy = label.y - centroid.y;
    if (Math.hypot(dx, dy) < 1) {
      return label;
    }
    const sx = dx === 0 ? Infinity : (width / 2) / Math.abs(dx);
    const sy = dy === 0 ? Infinity : (height / 2) / Math.abs(dy);
    const scale = Math.min(sx, sy, 1);
    return {
      x: label.x - dx * scale,
      y: label.y - dy * scale,
    };
  }

  function polygonPoints(cx, cy, sides, radius, rotation = -Math.PI / 2) {
    const points = [];
    for (let i = 0; i < sides; i += 1) {
      const angle = rotation + (2 * Math.PI * i) / sides;
      points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
    }
    return points.join(" ");
  }

  function markerElement(marker, x, y, size, color, opacity, selected = false) {
    const common = {
      fill: color,
      "fill-opacity": opacity,
      stroke: selected ? "#d62728" : "#222222",
      "stroke-width": selected ? 1.7 : 0.75,
      "stroke-opacity": 0.9,
    };
    const s = selected ? size * 1.18 : size;
    if (marker === "s") {
      return el("rect", { ...common, x: x - s, y: y - s, width: 2 * s, height: 2 * s });
    }
    if (marker === "^") {
      return el("polygon", { ...common, points: `${x},${y - 1.25 * s} ${x - 1.15 * s},${y + s} ${x + 1.15 * s},${y + s}` });
    }
    if (marker === "D") {
      return el("polygon", { ...common, points: `${x},${y - 1.2 * s} ${x + 1.2 * s},${y} ${x},${y + 1.2 * s} ${x - 1.2 * s},${y}` });
    }
    if (marker === "v") {
      return el("polygon", { ...common, points: `${x},${y + 1.25 * s} ${x - 1.15 * s},${y - s} ${x + 1.15 * s},${y - s}` });
    }
    if (marker === "<") {
      return el("polygon", { ...common, points: `${x - 1.25 * s},${y} ${x + s},${y - 1.15 * s} ${x + s},${y + 1.15 * s}` });
    }
    if (marker === ">") {
      return el("polygon", { ...common, points: `${x + 1.25 * s},${y} ${x - s},${y - 1.15 * s} ${x - s},${y + 1.15 * s}` });
    }
    if (marker === "h") {
      return el("polygon", { ...common, points: polygonPoints(x, y, 6, 1.18 * s, Math.PI / 6) });
    }
    if (marker === "p" || marker === "P" || marker === "*") {
      return el("polygon", { ...common, points: polygonPoints(x, y, 5, 1.2 * s) });
    }
    if (marker === "X") {
      const group = el("g");
      group.appendChild(el("line", { x1: x - s, y1: y - s, x2: x + s, y2: y + s, stroke: color, "stroke-width": selected ? 3 : 2.3, "stroke-linecap": "round", "stroke-opacity": opacity }));
      group.appendChild(el("line", { x1: x + s, y1: y - s, x2: x - s, y2: y + s, stroke: color, "stroke-width": selected ? 3 : 2.3, "stroke-linecap": "round", "stroke-opacity": opacity }));
      return group;
    }
    return el("circle", { ...common, cx: x, cy: y, r: s });
  }

  function addTitle(node, sample, pcx, pcy) {
    if (!hoverEnabled) {
      return;
    }
    const title = el("title");
    title.textContent = `${sample.sample}\n${sample.pop}\nPC${pcx}: ${formatTick(sample.pcs[pcx - 1])}\nPC${pcy}: ${formatTick(sample.pcs[pcy - 1])}`;
    node.insertBefore(title, node.firstChild);
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  function nearestHoverSample(point) {
    if (!hoverEnabled || !frame || !inPlot(point)) {
      return null;
    }
    const pair = currentPairInfo();
    let nearest = null;
    let nearestDistance = Infinity;
    const threshold = Math.max(12, markerSize() * 3.5);
    for (const sample of visibleSamples()) {
      const screen = dataToScreen(sample.pcs[pair.pcx - 1], sample.pcs[pair.pcy - 1]);
      const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
      if (distance < nearestDistance && distance <= threshold) {
        nearest = { sample, screen };
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function updateTooltip(point) {
    const hit = nearestHoverSample(point);
    if (!hit) {
      hideTooltip();
      return;
    }
    const pair = currentPairInfo();
    tooltip.textContent = `${hit.sample.sample}\n${hit.sample.pop}\nPC${pair.pcx}: ${formatTick(hit.sample.pcs[pair.pcx - 1])}\nPC${pair.pcy}: ${formatTick(hit.sample.pcs[pair.pcy - 1])}`;
    tooltip.style.display = "block";
    const left = Math.max(8, Math.min(hit.screen.x + 12, frame.width - tooltip.offsetWidth - 8));
    const top = Math.max(8, Math.min(hit.screen.y + 12, frame.height - tooltip.offsetHeight - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function screenToData(x, y) {
    return {
      x: view.xMin + ((x - frame.margin.left) / frame.innerWidth) * (view.xMax - view.xMin),
      y: view.yMin + ((frame.plotBottom - y) / frame.innerHeight) * (view.yMax - view.yMin),
    };
  }

  function dataToScreen(x, y) {
    return {
      x: frame.margin.left + ((x - view.xMin) / (view.xMax - view.xMin)) * frame.innerWidth,
      y: frame.plotBottom - ((y - view.yMin) / (view.yMax - view.yMin)) * frame.innerHeight,
    };
  }

  function eventPoint(event) {
    const rect = svg.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (frame.width / rect.width),
      y: (event.clientY - rect.top) * (frame.height / rect.height),
    };
  }

  function inPlot(point) {
    return (
      frame &&
      point.x >= frame.margin.left &&
      point.x <= frame.plotRight &&
      point.y >= frame.margin.top &&
      point.y <= frame.plotBottom
    );
  }

  function pointsForPop(pop, pcx, pcy) {
    return data.samples
      .filter((sample) => sample.pop === pop && !hiddenPops.has(pop))
      .map((sample) => ({ x: sample.pcs[pcx - 1], y: sample.pcs[pcy - 1], sample }));
  }

  function convexHull(points) {
    if (points.length < 3) {
      return points;
    }
    const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const point = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function regressionLine(points) {
    if (points.length < 2) {
      return null;
    }
    const n = points.length;
    const sx = points.reduce((total, point) => total + point.x, 0);
    const sy = points.reduce((total, point) => total + point.y, 0);
    const sxx = points.reduce((total, point) => total + point.x * point.x, 0);
    const sxy = points.reduce((total, point) => total + point.x * point.y, 0);
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) {
      const yValues = points.map((point) => point.y);
      return { x0: points[0].x, y0: Math.min(...yValues), x1: points[0].x, y1: Math.max(...yValues) };
    }
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    const xValues = points.map((point) => point.x);
    const x0 = Math.min(...xValues);
    const x1 = Math.max(...xValues);
    return { x0, y0: intercept + slope * x0, x1, y1: intercept + slope * x1 };
  }

  function pathFromScreenPoints(points, close = false) {
    if (!points.length) {
      return "";
    }
    const body = points.map((point) => `${point.x},${point.y}`).join(" L ");
    return `M ${body}${close ? " Z" : ""}`;
  }

  function drawHulls(pcx, pcy) {
    if (!hullsVisible) {
      return;
    }
    for (const pop of data.pops) {
      const points = pointsForPop(pop, pcx, pcy);
      if (points.length < 2) {
        continue;
      }
      const color = colorForPop(pop);
      if (points.length === 2) {
        const a = dataToScreen(points[0].x, points[0].y);
        const b = dataToScreen(points[1].x, points[1].y);
        svg.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, "stroke-width": 2, "stroke-opacity": hullOpacityValues[hullOpacityIndex] + 0.15 }));
        continue;
      }
      const hull = convexHull(points).map((point) => dataToScreen(point.x, point.y));
      svg.appendChild(el("path", {
        d: pathFromScreenPoints(hull, true),
        fill: color,
        "fill-opacity": hullOpacityValues[hullOpacityIndex],
        stroke: color,
        "stroke-opacity": hullOpacityValues[hullOpacityIndex] + 0.15,
        "stroke-width": 1,
      }));
    }
  }

  function drawRegressions(pcx, pcy) {
    if (!regressionVisible) {
      return;
    }
    for (const pop of data.pops) {
      const points = pointsForPop(pop, pcx, pcy);
      const line = regressionLine(points);
      if (!line) {
        continue;
      }
      const a = dataToScreen(line.x0, line.y0);
      const b = dataToScreen(line.x1, line.y1);
      svg.appendChild(el("line", {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: colorForPop(pop),
        "stroke-width": 1.6,
        "stroke-dasharray": "3 3",
        "stroke-opacity": 0.7,
      }));
    }
  }

  function drawGroupLabels(pcx, pcy) {
    if (!groupLabels) {
      return;
    }
    for (const [index, pop] of data.pops.entries()) {
      const points = pointsForPop(pop, pcx, pcy);
      if (!points.length) {
        continue;
      }
      const meanX = points.reduce((total, point) => total + point.x, 0) / points.length;
      const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
      const centroid = dataToScreen(meanX, meanY);
      const label = `${pop} (${points.length})`;
      const labelWidth = estimateTextWidth(label, 11) + 14;
      const labelHeight = 20;
      const offset = groupLabelOffsets.get(groupLabelKey(pop)) || defaultGroupLabelOffset(index);
      const x = clamp(centroid.x + offset.dx, frame.margin.left + labelWidth / 2 + 5, frame.plotRight - labelWidth / 2 - 5);
      const y = clamp(centroid.y + offset.dy, frame.margin.top + labelHeight / 2 + 5, frame.plotBottom - labelHeight / 2 - 5);
      const labelPosition = { x, y };
      const lineEnd = labelLineEnd(centroid, labelPosition, labelWidth, labelHeight);
      svg.appendChild(el("line", {
        x1: centroid.x,
        y1: centroid.y,
        x2: lineEnd.x,
        y2: lineEnd.y,
        class: "group-label-line",
        stroke: colorForPop(pop),
        "stroke-opacity": groupLabelStyle === 2 ? 0.68 : 0.44,
      }));
      const group = el("g", {
        class: "group-label-badge",
        "data-pop": pop,
        "data-label-x": x,
        "data-label-y": y,
        "data-centroid-x": centroid.x,
        "data-centroid-y": centroid.y,
        "data-label-width": labelWidth,
        "data-label-height": labelHeight,
      });
      group.appendChild(el("rect", {
        x: x - labelWidth / 2,
        y: y - labelHeight / 2,
        width: labelWidth,
        height: labelHeight,
        rx: 4,
        ry: 4,
        class: "group-label-hitbox",
        fill: "#ffffff",
        "fill-opacity": 0,
        stroke: "none",
      }));
      if (groupLabelStyle !== 1) {
        group.appendChild(el("rect", {
          x: x - labelWidth / 2,
          y: y - labelHeight / 2,
          width: labelWidth,
          height: labelHeight,
          rx: 4,
          ry: 4,
          class: "group-label-bg",
          fill: "#ffffff",
          "fill-opacity": groupLabelStyle === 2 ? 0.68 : 0.52,
          stroke: colorForPop(pop),
          "stroke-opacity": groupLabelStyle === 2 ? 0.78 : 0.48,
          "stroke-width": groupLabelStyle === 2 ? 1.5 : 1,
        }));
      }
      const text = el("text", {
        x,
        y: y + 4,
        "text-anchor": "middle",
        class: "group-label",
        fill: colorForPop(pop),
      }, label);
      if (groupLabelStyle === 1) {
        text.setAttribute("stroke-width", "0");
      } else if (groupLabelStyle === 2) {
        text.setAttribute("stroke-width", "4");
      } else {
        text.setAttribute("stroke-width", "2.4");
      }
      group.appendChild(text);
      group.addEventListener("pointerdown", startGroupLabelDrag);
      svg.appendChild(group);
    }
  }

  function drawPlot() {
    clear(svg);
    updateMeta();

    const pair = currentPairInfo();
    const pcx = pair.pcx;
    const pcy = pair.pcy;
    const rect = graph.getBoundingClientRect();
    const width = Math.max(640, Math.floor(rect.width));
    const height = Math.max(420, Math.floor(rect.height));
    frame = layoutFrame(width, height);
    positionLegend();
    const { margin, innerWidth, innerHeight, plotRight, plotBottom } = frame;

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.appendChild(el("title", { id: "plotTitle" }, `${data.title} - ${pair.label}`));
    svg.appendChild(el("rect", { x: 0, y: 0, width, height, fill: "#ffffff" }));
    svg.appendChild(el("text", { x: margin.left, y: 24, "text-anchor": "start", class: "plot-heading" }, pair.label));
    if (subtitle) {
      svg.appendChild(el("text", { x: margin.left, y: 41, "text-anchor": "start", class: "plot-subtitle" }, subtitle));
    }

    for (const tick of niceTicks(view.xMin, view.xMax)) {
      const x = dataToScreen(tick, view.yMin).x;
      svg.appendChild(el("line", { x1: x, y1: margin.top, x2: x, y2: plotBottom, stroke: "#edf0f2", "stroke-width": 1 }));
      svg.appendChild(el("line", { x1: x, y1: plotBottom, x2: x, y2: plotBottom + 5, stroke: "#222529", "stroke-width": 1 }));
      svg.appendChild(el("text", { x, y: plotBottom + 21, "text-anchor": "middle", class: "tick-label" }, formatTick(tick)));
    }
    for (const tick of niceTicks(view.yMin, view.yMax)) {
      const y = dataToScreen(view.xMin, tick).y;
      svg.appendChild(el("line", { x1: margin.left, y1: y, x2: plotRight, y2: y, stroke: "#edf0f2", "stroke-width": 1 }));
      svg.appendChild(el("line", { x1: margin.left - 5, y1: y, x2: margin.left, y2: y, stroke: "#222529", "stroke-width": 1 }));
      svg.appendChild(el("text", { x: margin.left - 9, y: y + 4, "text-anchor": "end", class: "tick-label" }, formatTick(tick)));
    }

    if (view.xMin < 0 && view.xMax > 0) {
      const x = dataToScreen(0, view.yMin).x;
      svg.appendChild(el("line", { x1: x, y1: margin.top, x2: x, y2: plotBottom, stroke: "#cfd5da", "stroke-width": 1 }));
    }
    if (view.yMin < 0 && view.yMax > 0) {
      const y = dataToScreen(view.xMin, 0).y;
      svg.appendChild(el("line", { x1: margin.left, y1: y, x2: plotRight, y2: y, stroke: "#cfd5da", "stroke-width": 1 }));
    }

    svg.appendChild(el("rect", { x: margin.left, y: margin.top, width: innerWidth, height: innerHeight, fill: "none", stroke: "#222529", "stroke-width": 1 }));

    drawHulls(pcx, pcy);
    drawRegressions(pcx, pcy);

    for (const pop of data.pops) {
      if (hiddenPops.has(pop)) {
        continue;
      }
      const color = colorForPop(pop);
      const style = data.styles[pop];
      for (const sample of data.samples) {
        if (sample.pop !== pop) {
          continue;
        }
        const pointPos = dataToScreen(sample.pcs[pcx - 1], sample.pcs[pcy - 1]);
        const selected = selectedSamples.has(sampleKey(sample));
        const point = markerElement(style.marker, pointPos.x, pointPos.y, markerSize(), color, data.alpha, selected);
        addTitle(point, sample, pcx, pcy);
        svg.appendChild(point);
        if (labelMode > 0) {
          const label = labelMode === 1 ? sample.sample : sample.pop;
          svg.appendChild(el("text", {
            x: pointPos.x,
            y: pointPos.y - markerSize() - 4,
            "text-anchor": "middle",
            class: "point-label",
            fill: color,
          }, label));
        }
      }
    }

    drawGroupLabels(pcx, pcy);

    if (selectionRect) {
      const x = Math.min(selectionRect.x0, selectionRect.x1);
      const y = Math.min(selectionRect.y0, selectionRect.y1);
      svg.appendChild(el("rect", {
        x,
        y,
        width: Math.abs(selectionRect.x1 - selectionRect.x0),
        height: Math.abs(selectionRect.y1 - selectionRect.y0),
        class: "selection-box",
      }));
    }
    if (lassoPoints.length > 1) {
      svg.appendChild(el("path", { d: pathFromScreenPoints(lassoPoints, false), class: "lasso-line" }));
    }
    if (spikesVisible && spikePoint && inPlot(spikePoint)) {
      svg.appendChild(el("line", { x1: spikePoint.x, y1: margin.top, x2: spikePoint.x, y2: plotBottom, class: "spike-line" }));
      svg.appendChild(el("line", { x1: margin.left, y1: spikePoint.y, x2: plotRight, y2: spikePoint.y, class: "spike-line" }));
    }

    svg.appendChild(el("text", { x: margin.left + innerWidth / 2, y: plotBottom + 43, "text-anchor": "middle", class: "axis-label" }, `PC${pcx}`));
    const yAxisLabelX = margin.left - 54;
    const yAxisLabelY = margin.top + innerHeight / 2;
    svg.appendChild(el("text", { x: yAxisLabelX, y: yAxisLabelY, "text-anchor": "middle", class: "axis-label", transform: `rotate(-90 ${yAxisLabelX} ${yAxisLabelY})` }, `PC${pcy}`));
    updateToolButtons();
    if (!hoverEnabled) {
      hideTooltip();
    }
  }

  function drawLegend() {
    clear(legend);
    for (const pop of data.pops) {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.dataset.pop = pop;
      item.title = "Click to show/hide. Double-click to isolate/restore.";
      const icon = document.createElementNS(ns, "svg");
      icon.classList.add("legend-icon");
      icon.setAttribute("viewBox", "0 0 18 18");
      icon.appendChild(markerElement(data.styles[pop].marker, 9, 9, 4.2, colorForPop(pop), data.alpha));
      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = pop;
      const count = document.createElement("span");
      count.className = "legend-count";
      count.textContent = data.counts[pop] || 0;
      item.appendChild(icon);
      item.appendChild(label);
      item.appendChild(count);
      item.addEventListener("click", () => {
        window.clearTimeout(clickTimer);
        clickTimer = window.setTimeout(() => {
          if (hiddenPops.has(pop)) {
            hiddenPops.delete(pop);
          } else {
            hiddenPops.add(pop);
          }
          refresh();
        }, 180);
      });
      item.addEventListener("dblclick", () => {
        window.clearTimeout(clickTimer);
        const onlyThisVisible = visiblePops().length === 1 && !hiddenPops.has(pop);
        hiddenPops.clear();
        if (!onlyThisVisible) {
          for (const otherPop of data.pops) {
            if (otherPop !== pop) {
              hiddenPops.add(otherPop);
            }
          }
        }
        refresh();
      });
      legend.appendChild(item);
    }
    syncLegend();
  }

  function syncLegend() {
    legend.style.display = legendVisible ? "" : "none";
    positionLegend();
    for (const item of legend.querySelectorAll(".legend-item")) {
      item.classList.toggle("is-hidden", hiddenPops.has(item.dataset.pop));
    }
  }

  function setActiveTool(tool) {
    activeTool = tool;
    updateToolButtons();
  }

  function zoomAt(factor, cx = null, cy = null) {
    const center = cx === null || cy === null
      ? { x: (view.xMin + view.xMax) / 2, y: (view.yMin + view.yMax) / 2 }
      : screenToData(cx, cy);
    const left = center.x - view.xMin;
    const right = view.xMax - center.x;
    const bottom = center.y - view.yMin;
    const top = view.yMax - center.y;
    view = {
      xMin: center.x - left * factor,
      xMax: center.x + right * factor,
      yMin: center.y - bottom * factor,
      yMax: center.y + top * factor,
    };
    drawPlot();
  }

  function autoScaleVisible() {
    const pair = currentPairInfo();
    const samples = visibleSamples();
    if (!samples.length) {
      setViewToPair();
      drawPlot();
      return;
    }
    const xlim = axisLimits(samples.map((sample) => sample.pcs[pair.pcx - 1]));
    const ylim = axisLimits(samples.map((sample) => sample.pcs[pair.pcy - 1]));
    view = { xMin: xlim[0], xMax: xlim[1], yMin: ylim[0], yMax: ylim[1] };
    drawPlot();
  }

  function resetAxes() {
    setViewToPair();
    selectedSamples.clear();
    selectionRect = null;
    lassoPoints = [];
    drawPlot();
  }

  function resetPlot() {
    hiddenPops.clear();
    selectedSamples.clear();
    groupLabelOffsets.clear();
    subtitle = "";
    legendVisible = true;
    hoverEnabled = true;
    grayMode = false;
    labelMode = 0;
    markerScaleIndex = 0;
    squarePlot = false;
    groupLabels = false;
    groupLabelStyle = 0;
    hullsVisible = false;
    hullOpacityIndex = 0;
    regressionVisible = false;
    spikesVisible = false;
    labelDrag = null;
    selectionRect = null;
    lassoPoints = [];
    spikePoint = null;
    hideTooltip();
    setViewToPair();
    drawLegend();
    drawPlot();
  }

  function sanitizeFilename(value) {
    return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "smartPCA";
  }

  function downloadPng() {
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", ns);
    const style = el("style");
    style.textContent = ".axis-label{font:13px Arial}.tick-label{font:11px Arial;fill:#555c63}.plot-heading{font:bold 14px Arial}.plot-subtitle{font:12px Arial;fill:#6c757d}.point-label{font:10px Arial;paint-order:stroke;stroke:rgba(255,255,255,.84);stroke-width:3px}.group-label{font:bold 11px Arial;paint-order:stroke;stroke:rgba(255,255,255,.9);stroke-linejoin:round}.group-label-line{stroke-width:1}";
    clone.insertBefore(style, clone.firstChild);
    const source = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = frame.width * scale;
      canvas.height = frame.height * scale;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const link = document.createElement("a");
      link.download = `${sanitizeFilename(data.title)}_${select.value.replace(":", "_")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    image.src = url;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
  }

  function selectByRect(rect) {
    const pair = currentPairInfo();
    const x0 = Math.min(rect.x0, rect.x1);
    const x1 = Math.max(rect.x0, rect.x1);
    const y0 = Math.min(rect.y0, rect.y1);
    const y1 = Math.max(rect.y0, rect.y1);
    selectedSamples.clear();
    for (const sample of visibleSamples()) {
      const p = dataToScreen(sample.pcs[pair.pcx - 1], sample.pcs[pair.pcy - 1]);
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) {
        selectedSamples.add(sampleKey(sample));
      }
    }
  }

  function selectByLasso(points) {
    if (points.length < 3) {
      return;
    }
    const pair = currentPairInfo();
    selectedSamples.clear();
    for (const sample of visibleSamples()) {
      const p = dataToScreen(sample.pcs[pair.pcx - 1], sample.pcs[pair.pcy - 1]);
      if (pointInPolygon(p, points)) {
        selectedSamples.add(sampleKey(sample));
      }
    }
  }

  function startGroupLabelDrag(event) {
    event.preventDefault();
    event.stopPropagation();
    const point = eventPoint(event);
    const target = event.currentTarget;
    labelDrag = {
      pop: target.dataset.pop,
      x0: point.x,
      y0: point.y,
      labelX: Number(target.dataset.labelX),
      labelY: Number(target.dataset.labelY),
      centroidX: Number(target.dataset.centroidX),
      centroidY: Number(target.dataset.centroidY),
      width: Number(target.dataset.labelWidth),
      height: Number(target.dataset.labelHeight),
    };
    hideTooltip();
    svg.setPointerCapture(event.pointerId);
  }

  function moveGroupLabelDrag(event) {
    event.preventDefault();
    event.stopPropagation();
    const point = eventPoint(event);
    const x = clamp(
      labelDrag.labelX + point.x - labelDrag.x0,
      frame.margin.left + labelDrag.width / 2 + 5,
      frame.plotRight - labelDrag.width / 2 - 5
    );
    const y = clamp(
      labelDrag.labelY + point.y - labelDrag.y0,
      frame.margin.top + labelDrag.height / 2 + 5,
      frame.plotBottom - labelDrag.height / 2 - 5
    );
    groupLabelOffsets.set(groupLabelKey(labelDrag.pop), {
      dx: x - labelDrag.centroidX,
      dy: y - labelDrag.centroidY,
    });
    drawPlot();
  }

  function endGroupLabelDrag(event) {
    event.preventDefault();
    event.stopPropagation();
    labelDrag = null;
    if (svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
  }

  function startDrag(event) {
    if (!frame) {
      return;
    }
    const point = eventPoint(event);
    if (!inPlot(point)) {
      return;
    }
    event.preventDefault();
    hideTooltip();
    svg.setPointerCapture(event.pointerId);
    drag = { x0: point.x, y0: point.y, lastX: point.x, lastY: point.y };
    if (activeTool === "zoom" || activeTool === "select") {
      selectionRect = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
    } else if (activeTool === "lasso") {
      lassoPoints = [point];
    }
  }

  function moveDrag(event) {
    if (labelDrag) {
      moveGroupLabelDrag(event);
      return;
    }
    const point = eventPoint(event);
    spikePoint = inPlot(point) ? point : null;
    if (!drag) {
      updateTooltip(point);
    }
    if (!drag) {
      if (spikesVisible) {
        drawPlot();
      }
      return;
    }
    event.preventDefault();
    if (activeTool === "pan") {
      const dx = point.x - drag.lastX;
      const dy = point.y - drag.lastY;
      const xRange = view.xMax - view.xMin;
      const yRange = view.yMax - view.yMin;
      view.xMin -= (dx / frame.innerWidth) * xRange;
      view.xMax -= (dx / frame.innerWidth) * xRange;
      view.yMin += (dy / frame.innerHeight) * yRange;
      view.yMax += (dy / frame.innerHeight) * yRange;
      drag.lastX = point.x;
      drag.lastY = point.y;
    } else if (activeTool === "zoom" || activeTool === "select") {
      selectionRect.x1 = Math.max(frame.margin.left, Math.min(frame.plotRight, point.x));
      selectionRect.y1 = Math.max(frame.margin.top, Math.min(frame.plotBottom, point.y));
    } else if (activeTool === "lasso" && inPlot(point)) {
      lassoPoints.push(point);
    }
    drawPlot();
  }

  function endDrag(event) {
    if (labelDrag) {
      endGroupLabelDrag(event);
      return;
    }
    if (!drag) {
      return;
    }
    svg.releasePointerCapture(event.pointerId);
    if (activeTool === "zoom" && selectionRect) {
      const width = Math.abs(selectionRect.x1 - selectionRect.x0);
      const height = Math.abs(selectionRect.y1 - selectionRect.y0);
      if (width > 6 && height > 6) {
        const a = screenToData(Math.min(selectionRect.x0, selectionRect.x1), Math.max(selectionRect.y0, selectionRect.y1));
        const b = screenToData(Math.max(selectionRect.x0, selectionRect.x1), Math.min(selectionRect.y0, selectionRect.y1));
        view = { xMin: a.x, xMax: b.x, yMin: a.y, yMax: b.y };
      }
    } else if (activeTool === "select" && selectionRect) {
      selectByRect(selectionRect);
    } else if (activeTool === "lasso") {
      selectByLasso(lassoPoints);
    }
    drag = null;
    selectionRect = null;
    lassoPoints = [];
    drawPlot();
  }

  function buildToolbar() {
    const controls = [
      ["png", "PNG", "Download PNG", () => downloadPng()],
      ["zoom", "Zoom", "Drag box to zoom", () => setActiveTool("zoom"), () => activeTool === "zoom"],
      ["pan", "Pan", "Drag to pan", () => setActiveTool("pan"), () => activeTool === "pan"],
      ["select", "Box", "Drag box to select samples", () => setActiveTool("select"), () => activeTool === "select"],
      ["lasso", "Lasso", "Draw lasso to select samples", () => setActiveTool("lasso"), () => activeTool === "lasso"],
      ["zoomin", "+", "Zoom in", () => zoomAt(0.75)],
      ["zoomout", "-", "Zoom out", () => zoomAt(1.33)],
      ["autoscale", "Auto", "Autoscale to visible populations", () => autoScaleVisible()],
      ["resetaxes", "Home", "Reset axes", () => resetAxes()],
      ["spikes", "Spike", "Toggle cursor spike lines", () => { spikesVisible = !spikesVisible; drawPlot(); }, () => spikesVisible],
      ["subtitle", "Sub", "Add or clear subtitle", () => { const value = prompt("Subtitle", subtitle); subtitle = value === null ? "" : value.trim(); drawPlot(); }],
      ["legend", "Leg", "Toggle legend", () => { legendVisible = !legendVisible; syncLegend(); drawPlot(); }, () => legendVisible],
      ["visibility", "Vis", "Show or hide all populations", () => { if (visiblePops().length) { for (const pop of data.pops) hiddenPops.add(pop); } else { hiddenPops.clear(); } refresh(); }],
      ["hover", "Tip", "Toggle hover text", () => { hoverEnabled = !hoverEnabled; drawPlot(); }, () => hoverEnabled],
      ["gray", "Gray", "Toggle color or gray", () => { grayMode = !grayMode; drawLegend(); drawPlot(); }, () => grayMode],
      ["labels", "Aa", "Cycle point labels: none/sample/population", () => { labelMode = (labelMode + 1) % 3; drawPlot(); }, () => labelMode > 0],
      ["size", "Dot", "Cycle marker size", () => { markerScaleIndex = (markerScaleIndex + 1) % markerScales.length; drawLegend(); drawPlot(); }, () => markerScaleIndex !== 0],
      ["square", "Sq", "Toggle square plot area", () => { squarePlot = !squarePlot; drawPlot(); }, () => squarePlot],
      ["groupstyle", "Lbl", "Cycle group label style", () => { groupLabelStyle = (groupLabelStyle + 1) % 3; drawPlot(); }, () => groupLabelStyle !== 0],
      ["groups", "Grp", "Toggle population centroid labels", () => { groupLabels = !groupLabels; drawPlot(); }, () => groupLabels],
      ["hulls", "Hull", "Toggle convex hulls", () => { hullsVisible = !hullsVisible; drawPlot(); }, () => hullsVisible],
      ["hullop", "Op", "Cycle hull opacity", () => { hullOpacityIndex = (hullOpacityIndex + 1) % hullOpacityValues.length; drawPlot(); }, () => hullOpacityIndex !== 0],
      ["regression", "Reg", "Toggle regression lines", () => { regressionVisible = !regressionVisible; drawPlot(); }, () => regressionVisible],
    ];
    for (const [id, label, title, action, active] of controls) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool-button";
      button.dataset.tool = id;
      button.textContent = label;
      button.title = title;
      button.addEventListener("click", action);
      button.isActive = active || (() => false);
      modebar.appendChild(button);
    }
  }

  function updateToolButtons() {
    for (const button of modebar.querySelectorAll(".tool-button")) {
      button.classList.toggle("is-active", button.isActive());
    }
  }

  function refresh() {
    syncLegend();
    drawPlot();
  }

  function handleWheel(event) {
    if (!frame) {
      return;
    }
    const point = eventPoint(event);
    if (!inPlot(point)) {
      return;
    }
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 0.88 : 1.14, point.x, point.y);
  }

  for (const pair of data.pairs) {
    const option = document.createElement("option");
    option.value = pair.key;
    option.textContent = pair.label;
    select.appendChild(option);
  }
  select.value = data.startPair;
  currentPair = select.value;
  setViewToPair();
  select.addEventListener("change", () => {
    currentPair = select.value;
    selectedSamples.clear();
    setViewToPair();
    drawPlot();
  });
  resetButton.addEventListener("click", resetPlot);
  svg.addEventListener("pointerdown", startDrag);
  svg.addEventListener("pointermove", moveDrag);
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("mouseleave", () => {
    spikePoint = null;
    hideTooltip();
    if (spikesVisible) {
      drawPlot();
    }
  });
  svg.addEventListener("wheel", handleWheel, { passive: false });
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(drawPlot, 80);
  });

  buildToolbar();
  drawLegend();
  drawPlot();
})();
