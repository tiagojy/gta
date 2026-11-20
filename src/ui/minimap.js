import { GUN_SHOP_CODE } from '../shop/shop-location.js?v=1';
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.viewRange = 1900;
    this.logoImages = new Map();
  }

  #getOrLoadLogo(url) {
    if (!url || typeof Image === 'undefined') return null;
    const existing = this.logoImages.get(url);
    if (existing) return existing;
    const img = new Image();
    img._failed = false;
    img.onerror = () => {
      img._failed = true;
    };
    img.src = url;
    this.logoImages.set(url, img);
    return img;
  }

  #drawMapScene(ctx, w, h, {
    cityMap,
    player,
    routePoints,
    objectivePoint,
    worldCollectibles = [],
    encounterLocations = null,
    waypoint = null,
    waypointRoutePoints = null,
    scale,
    centerX,
    centerY,
    visibleMinX,
    visibleMaxX,
    visibleMinY,
    visibleMaxY,
    expanded = false,
  }) {
    ctx.fillStyle = '#144970';
    ctx.fillRect(0, 0, w, h);

    const toMiniX = (wx) => w * 0.5 + (wx - centerX) * scale;
    const toMiniY = (wy) => h * 0.5 + (wy - centerY) * scale;

    ctx.fillStyle = '#1b202b';
    ctx.fillRect(
      toMiniX(0),
      toMiniY(0),
      cityMap.worldWidth * scale,
      cityMap.worldHeight * scale,
    );

    const blocks = cityMap.getVisibleBlocks(visibleMinX, visibleMinY, visibleMaxX, visibleMaxY);
    for (const block of blocks) {
      const b = block.bounds;
      ctx.fillStyle = block.isPlaza ? '#2d6a4f' : '#3a4254';
      ctx.fillRect(toMiniX(b.x), toMiniY(b.y), b.w * scale, b.h * scale);

      for (const building of block.buildings) {
        const bb = building.bounds;
        const bx = toMiniX(bb.x);
        const by = toMiniY(bb.y);
        const bw = bb.w * scale;
        const bh = bb.h * scale;
        if (building.type === 'hospital') {
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(bx, by, bw, bh);
          const cx = bx + bw * 0.5;
          const cy = by + bh * 0.5;
          const arm = Math.max(expanded ? 4 : 6, Math.min(bw, bh) * 0.85);
          const thick = Math.max(1.5, arm * 0.32);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(cx - thick * 0.5, cy - arm * 0.5, thick, arm);
          ctx.fillRect(cx - arm * 0.5, cy - thick * 0.5, arm, thick);
        } else if (
          encounterLocations instanceof Map
            ? encounterLocations.has(building.code)
            : Boolean(encounterLocations?.has?.(building.code))
        ) {
          const meta = encounterLocations instanceof Map ? encounterLocations.get(building.code) : {};
          ctx.fillStyle = meta?.roofColor || '#dc2626';
          ctx.fillRect(bx, by, bw, bh);
          const logoImg = meta?.roofLogo ? this.#getOrLoadLogo(meta.roofLogo) : null;
          if (logoImg && !logoImg._failed && logoImg.complete && logoImg.naturalWidth > 0) {
            const box = Math.max(8, Math.min(bw, bh) * 0.85);
            ctx.drawImage(logoImg, bx + (bw - box) * 0.5, by + (bh - box) * 0.5, box, box);
          } else {
            const cx = bx + bw * 0.5;
            const cy = by + bh * 0.5;
            ctx.save();
            const fontSize = expanded
              ? Math.max(16, Math.round(Math.min(w, h) * 0.036))
              : Math.max(10, Math.round(Math.max(bw, bh) * 0.85));
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = expanded ? 3.5 : 2;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fillStyle = '#ffffff';
            ctx.strokeText('!', cx, cy);
            ctx.fillText('!', cx, cy);
            ctx.restore();
          }
        } else {
          ctx.fillStyle = building.code === GUN_SHOP_CODE ? '#c0392b' : building.type === 'commerce' ? '#4f6d9a' : '#7c5c4e';
          ctx.fillRect(bx, by, bw, bh);
        }
      }
    }

    if (routePoints && routePoints.length > 1) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = expanded ? 3 : 2.5;
      ctx.beginPath();
      ctx.moveTo(toMiniX(routePoints[0].x), toMiniY(routePoints[0].y));
      for (let i = 1; i < routePoints.length; i += 1) {
        ctx.lineTo(toMiniX(routePoints[i].x), toMiniY(routePoints[i].y));
      }
      ctx.stroke();
    }

    if (objectivePoint) {
      const rawOx = toMiniX(objectivePoint.x);
      const rawOy = toMiniY(objectivePoint.y);
      const pad = 8;
      const isOutOfView =
        !expanded && (rawOx < pad || rawOx > w - pad || rawOy < pad || rawOy > h - pad);

      if (isOutOfView) {
        const cx = w * 0.5;
        const cy = h * 0.5;
        const dx = rawOx - cx;
        const dy = rawOy - cy;
        const angle = Math.atan2(dy, dx);
        const halfW = Math.max(1, cx - pad);
        const halfH = Math.max(1, cy - pad);
        const clampScale = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH, 1);
        const bx = cx + dx / clampScale;
        const by = cy + dy / clampScale;

        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(angle);
        ctx.fillStyle = '#fbbf24';
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(6.5, 0);
        ctx.lineTo(-4.5, -5);
        ctx.lineTo(-4.5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        if (expanded) {
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(rawOx, rawOy, 10, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(rawOx, rawOy, expanded ? 6 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    if (waypointRoutePoints && waypointRoutePoints.length > 1) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = expanded ? 3 : 2.5;
      ctx.beginPath();
      ctx.moveTo(toMiniX(waypointRoutePoints[0].x), toMiniY(waypointRoutePoints[0].y));
      for (let i = 1; i < waypointRoutePoints.length; i += 1) {
        ctx.lineTo(toMiniX(waypointRoutePoints[i].x), toMiniY(waypointRoutePoints[i].y));
      }
      ctx.stroke();
    }

    if (waypoint) {
      const wx = toMiniX(waypoint.x);
      const wy = toMiniY(waypoint.y);
      const pad = 8;
      const outOfView = !expanded && (wx < pad || wx > w - pad || wy < pad || wy > h - pad);
      if (outOfView) {
        const cx = w * 0.5;
        const cy = h * 0.5;
        const dx = wx - cx;
        const dy = wy - cy;
        const clampScale = Math.max(Math.abs(dx) / Math.max(1, cx - pad), Math.abs(dy) / Math.max(1, cy - pad), 1);
        ctx.save();
        ctx.translate(cx + dx / clampScale, cy + dy / clampScale);
        ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = '#f43f5e';
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(6.5, 0);
        ctx.lineTo(-4.5, -5);
        ctx.lineTo(-4.5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        if (expanded) {
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.55)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(wx, wy, 10, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(wx, wy, expanded ? 6 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    if (worldCollectibles && worldCollectibles.length > 0) {
      ctx.save();
      const expandedFontSize = Math.max(19, Math.round(Math.min(w, h) * 0.045));
      ctx.font = expanded ? `bold ${expandedFontSize}px sans-serif` : 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = expanded ? 4 : 2.5;
      ctx.strokeStyle = '#0f172a';
      for (const c of worldCollectibles) {
        if (c.collected) continue;
        const cx = toMiniX(c.x);
        const cy = toMiniY(c.y);
        if (cx < -6 || cx > w + 6 || cy < -6 || cy > h + 6) continue;
        ctx.fillStyle = c.rarity === 'lendario'
          ? '#facc15'
          : c.rarity === 'especial'
            ? '#c084fc'
            : '#38bdf8';
        ctx.strokeText('?', cx, cy);
        ctx.fillText('?', cx, cy);
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(toMiniX(player.x), toMiniY(player.y));
    ctx.rotate(player.angle);
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = expanded ? 2 : 1.2;
    ctx.beginPath();
    const s = expanded ? 1.25 : 1;
    ctx.moveTo(7 * s, 0);
    ctx.lineTo(-5 * s, -4.5 * s);
    ctx.lineTo(-3 * s, 0);
    ctx.lineTo(-5 * s, 4.5 * s);
    ctx.closePath();
    if (expanded) ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  render(cityMap, player, routePoints, objectivePoint, worldCollectibles = [], encounterLocations = null, extras = null) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scale = w / (this.viewRange * 2);
    this.#drawMapScene(ctx, w, h, {
      cityMap,
      player,
      routePoints,
      objectivePoint,
      worldCollectibles,
      encounterLocations,
      waypoint: extras?.waypoint || null,
      waypointRoutePoints: extras?.waypointRoutePoints || null,
      scale,
      centerX: player.x,
      centerY: player.y,
      visibleMinX: player.x - this.viewRange,
      visibleMaxX: player.x + this.viewRange,
      visibleMinY: player.y - this.viewRange,
      visibleMaxY: player.y + this.viewRange,
      expanded: false,
    });
  }

  getExpandedCanvasSize(viewportWidth = 800, viewportHeight = 600) {
    const maxW = Math.max(240, Math.min(1380, Math.floor(viewportWidth * 0.88)));
    const maxH = Math.max(180, Math.floor(viewportHeight * 0.76));
    const aspect = Math.max(0.45, Math.min(2.0, viewportWidth / Math.max(1, viewportHeight)));
    let width = maxW;
    let height = Math.round(width / aspect);
    if (height > maxH) {
      height = maxH;
      width = Math.round(height * aspect);
    }
    return { width, height };
  }

  getExpandedBaseScale(expandedCanvas, cityMap) {
    if (!expandedCanvas || !cityMap) return 1;
    return Math.min(expandedCanvas.width / cityMap.worldWidth, expandedCanvas.height / cityMap.worldHeight) * 0.94;
  }

  computeInitialExpandedView(
    expandedCanvas,
    cityMap,
    player,
    objectivePoint,
    viewportWidth = 800,
    viewportHeight = 600,
  ) {
    if (!cityMap) return { zoom: 1, centerX: 0, centerY: 0 };
    const { width: targetW, height: targetH } = this.getExpandedCanvasSize(viewportWidth, viewportHeight);
    if (expandedCanvas && (expandedCanvas.width !== targetW || expandedCanvas.height !== targetH)) {
      expandedCanvas.width = targetW;
      expandedCanvas.height = targetH;
    }

    const baseScale = Math.min(targetW / cityMap.worldWidth, targetH / cityMap.worldHeight) * 0.94;
    const coverScale = Math.max(targetW / cityMap.worldWidth, targetH / cityMap.worldHeight);
    const coverZoom = Math.max(1, Math.min(6, coverScale / Math.max(0.0001, baseScale)));

    let zoom = coverZoom;
    let centerX = Number.isFinite(player?.x) ? player.x : cityMap.worldWidth * 0.5;
    let centerY = Number.isFinite(player?.y) ? player.y : cityMap.worldHeight * 0.5;

    if (objectivePoint && Number.isFinite(objectivePoint.x) && Number.isFinite(objectivePoint.y)) {
      const pad = Math.max(180, cityMap.worldWidth * 0.06);
      const spanX = Math.max(1, Math.abs(objectivePoint.x - centerX) + pad * 2);
      const spanY = Math.max(1, Math.abs(objectivePoint.y - centerY) + pad * 2);
      const fitPairScale = Math.min(targetW / spanX, targetH / spanY);
      const fitPairZoom = Math.max(1, Math.min(6, fitPairScale / Math.max(0.0001, baseScale)));
      zoom = Math.min(coverZoom, fitPairZoom);
      centerX = (centerX + objectivePoint.x) * 0.5;
      centerY = (centerY + objectivePoint.y) * 0.5;
    }

    const scale = baseScale * zoom;
    const halfVisibleW = (targetW * 0.5) / scale;
    const halfVisibleH = (targetH * 0.5) / scale;

    if (halfVisibleW * 2 >= cityMap.worldWidth) {
      centerX = cityMap.worldWidth * 0.5;
    } else {
      centerX = Math.max(halfVisibleW, Math.min(cityMap.worldWidth - halfVisibleW, centerX));
    }
    if (halfVisibleH * 2 >= cityMap.worldHeight) {
      centerY = cityMap.worldHeight * 0.5;
    } else {
      centerY = Math.max(halfVisibleH, Math.min(cityMap.worldHeight - halfVisibleH, centerY));
    }

    return { zoom, centerX, centerY };
  }

  renderExpanded(
    expandedCanvas,
    cityMap,
    player,
    routePoints,
    objectivePoint,
    worldCollectibles = [],
    viewportWidth = 800,
    viewportHeight = 600,
    viewState = null,
    encounterLocations = null,
    extras = null,
  ) {
    if (!expandedCanvas || !cityMap) return;
    const { width: targetW, height: targetH } = this.getExpandedCanvasSize(viewportWidth, viewportHeight);
    if (expandedCanvas.width !== targetW || expandedCanvas.height !== targetH) {
      expandedCanvas.width = targetW;
      expandedCanvas.height = targetH;
    }

    const ctx = expandedCanvas.getContext('2d');
    const baseScale = this.getExpandedBaseScale(expandedCanvas, cityMap);
    const zoom = Math.max(1, Math.min(6, Number(viewState?.zoom) || 1));
    const scale = baseScale * zoom;
    const centerX = Number.isFinite(viewState?.centerX) ? viewState.centerX : cityMap.worldWidth * 0.5;
    const centerY = Number.isFinite(viewState?.centerY) ? viewState.centerY : cityMap.worldHeight * 0.5;
    const halfVisibleW = (targetW * 0.5) / scale;
    const halfVisibleH = (targetH * 0.5) / scale;

    this.#drawMapScene(ctx, targetW, targetH, {
      cityMap,
      player,
      routePoints,
      objectivePoint,
      worldCollectibles,
      encounterLocations,
      waypoint: extras?.waypoint || null,
      waypointRoutePoints: extras?.waypointRoutePoints || null,
      scale,
      centerX,
      centerY,
      visibleMinX: Math.max(0, centerX - halfVisibleW),
      visibleMaxX: Math.min(cityMap.worldWidth, centerX + halfVisibleW),
      visibleMinY: Math.max(0, centerY - halfVisibleH),
      visibleMaxY: Math.min(cityMap.worldHeight, centerY + halfVisibleH),
      expanded: true,
    });
  }
}
