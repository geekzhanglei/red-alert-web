/**
 * 原创游戏贴图（docs/01-architecture.md 决策三：数据驱动 + 原创素材）。
 * 这里生成 data-URL 形式的 SVG 资源；Phaser 加载时直接拿 URL。
 * 全部手画、风格化、避开任何商业游戏元素。
 * 尺寸 64×32 = 2:1 等距菱形（渲染时作为菱形 4 顶点插图）。
 */

import type { Terrain } from '../game/state/map';

function svg(w: number, h: number, body: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  )}`;
}

// 地形 64×32（菱形底图）
function terrain(base: string, pattern: string, detail: string): string {
  return svg(
    64,
    32,
    `<polygon points="32,1 63,16 32,31 1,16" fill="${base}"/>
     ${pattern}
     <polygon points="32,1 63,16 32,31 1,16" fill="none" stroke="#0c1410" stroke-width="0.6" stroke-opacity="0.45"/>
     ${detail}`,
  );
}

export const SPRITES = {
  // ===== 地形 =====
  grass: terrain(
    '#4a8d56',
    `
      <polygon points="32,1 63,16 32,31 1,16" fill="#4a8d56"/>
      <ellipse cx="14" cy="22" rx="3" ry="1" fill="#5fa467" opacity="0.6"/>
      <ellipse cx="46" cy="20" rx="3" ry="1" fill="#5fa467" opacity="0.6"/>
      <ellipse cx="30" cy="8" rx="2.5" ry="1" fill="#5fa467" opacity="0.5"/>
      <ellipse cx="22" cy="14" rx="2" ry="0.8" fill="#3e7747" opacity="0.5"/>
      <ellipse cx="40" cy="26" rx="2" ry="0.8" fill="#3e7747" opacity="0.5"/>
    `,
    '',
  ),
  water: terrain(
    '#3870a8',
    `
      <polygon points="32,1 63,16 32,31 1,16" fill="#3870a8"/>
      <path d="M 6 16 Q 14 13 22 16 T 38 16 T 58 16" stroke="#76aed3" stroke-width="1.2" fill="none" opacity="0.8"/>
      <path d="M 6 20 Q 14 17 22 20 T 38 20 T 58 20" stroke="#5a96c0" stroke-width="0.8" fill="none" opacity="0.6"/>
      <path d="M 6 12 Q 14 9 22 12 T 38 12 T 58 12" stroke="#9cc8e0" stroke-width="0.6" fill="none" opacity="0.5"/>
    `,
    '',
  ),
  rock: terrain(
    '#7d7d80',
    `
      <polygon points="32,1 63,16 32,31 1,16" fill="#7d7d80"/>
      <polygon points="20,14 26,8 32,12 30,20 22,22" fill="#9a9a9d" stroke="#5a5a5d" stroke-width="0.4"/>
      <polygon points="38,18 46,12 50,18 44,22" fill="#9a9a9d" stroke="#5a5a5d" stroke-width="0.4"/>
      <polygon points="14,20 18,17 20,21" fill="#9a9a9d" stroke="#5a5a5d" stroke-width="0.4"/>
      <polygon points="46,8 50,11 47,13" fill="#5a5a5d" opacity="0.7"/>
    `,
    '',
  ),
  ore: terrain(
    '#8a7d3a',
    `
      <polygon points="32,1 63,16 32,31 1,16" fill="#8a7d3a"/>
      <circle cx="20" cy="20" r="1.6" fill="#d6b854"/>
      <circle cx="24" cy="14" r="1.4" fill="#d6b854"/>
      <circle cx="32" cy="22" r="1.8" fill="#e2c660"/>
      <circle cx="40" cy="18" r="1.5" fill="#d6b854"/>
      <circle cx="44" cy="24" r="1.3" fill="#d6b854"/>
      <circle cx="14" cy="14" r="1.2" fill="#c0a346"/>
      <circle cx="48" cy="12" r="1.2" fill="#c0a346"/>
    `,
    '',
  ),

  // ===== 单位（32×32，居中） =====
  // 玩家蓝 / 敌方红
  infantry: (owner: number) =>
    svg(
      32,
      32,
      `<g>
        <ellipse cx="16" cy="22" rx="6" ry="2" fill="#000" opacity="0.3"/>
        <circle cx="16" cy="14" r="5" fill="${owner === 0 ? '#3f7dff' : '#e04848'}" stroke="#1a1f2b" stroke-width="1"/>
        <rect x="13" y="14" width="6" height="2" fill="${owner === 0 ? '#5e94ff' : '#ee6c6c'}"/>
        <rect x="10" y="18" width="12" height="6" fill="${owner === 0 ? '#3f7dff' : '#e04848'}" stroke="#1a1f2b" stroke-width="0.8" rx="1"/>
        <rect x="22" y="14" width="6" height="1.5" fill="#3a3a3a"/>
        <rect x="26" y="14" width="1.5" height="1.5" fill="#e8c054"/>
        <circle cx="14" cy="12" r="0.6" fill="#fff"/>
      </g>`,
    ),
  tank: (owner: number) =>
    svg(
      32,
      32,
      `<g>
        <ellipse cx="16" cy="24" rx="11" ry="2.5" fill="#000" opacity="0.35"/>
        <!-- 履带 -->
        <rect x="5" y="18" width="22" height="5" fill="#2a2a2a" rx="1.5"/>
        <rect x="5" y="18" width="22" height="1" fill="#3d3d3d" rx="1"/>
        <rect x="5" y="22" width="22" height="1" fill="#3d3d3d" rx="1"/>
        <!-- 车身 -->
        <rect x="7" y="13" width="18" height="6" fill="${owner === 0 ? '#3a4a7a' : '#7a3a3a'}" stroke="#1a1f2b" stroke-width="0.8" rx="1"/>
        <!-- 炮塔 -->
        <circle cx="16" cy="14" r="4" fill="${owner === 0 ? '#4d6296' : '#9a4a4a'}" stroke="#1a1f2b" stroke-width="0.8"/>
        <!-- 炮管（向右） -->
        <rect x="20" y="13" width="9" height="2" fill="#2a2a2a"/>
        <rect x="27" y="12" width="1" height="4" fill="#3a3a3a"/>
        <circle cx="9" cy="20" r="0.9" fill="#5e5e5e"/>
        <circle cx="13" cy="20" r="0.9" fill="#5e5e5e"/>
        <circle cx="17" cy="20" r="0.9" fill="#5e5e5e"/>
        <circle cx="21" cy="20" r="0.9" fill="#5e5e5e"/>
      </g>`,
    ),
  harvester: (owner: number) =>
    svg(
      32,
      32,
      `<g>
        <ellipse cx="16" cy="24" rx="11" ry="2.5" fill="#000" opacity="0.35"/>
        <rect x="5" y="18" width="22" height="5" fill="#2a2a2a" rx="1.5"/>
        <rect x="5" y="18" width="22" height="1" fill="#3d3d3d" rx="1"/>
        <rect x="5" y="22" width="22" height="1" fill="#3d3d3d" rx="1"/>
        <!-- 矿斗 -->
        <rect x="9" y="9" width="14" height="10" fill="${owner === 0 ? '#5e7d3a' : '#7d5a3a'}" stroke="#1a1f2b" stroke-width="0.8" rx="1.5"/>
        <rect x="9" y="9" width="14" height="2" fill="${owner === 0 ? '#6e924a' : '#8a6a4a'}"/>
        <rect x="9" y="14" width="14" height="2" fill="${owner === 0 ? '#4a6a2e' : '#6a4a2e'}" opacity="0.5"/>
        <!-- 履带轮 -->
        <circle cx="9" cy="20" r="1.1" fill="#5e5e5e"/>
        <circle cx="14" cy="20" r="1.1" fill="#5e5e5e"/>
        <circle cx="19" cy="20" r="1.1" fill="#5e5e5e"/>
        <circle cx="23" cy="20" r="1.1" fill="#5e5e5e"/>
      </g>`,
    ),

  // ===== 建筑（96×96, footprint 多格共用）=====
  // base：3×3 footprint
  base: (owner: number) =>
    svg(
      96,
      96,
      `<g>
        <!-- 主平台 -->
        <polygon points="48,8 88,32 48,56 8,32" fill="${owner === 0 ? '#2a3a5a' : '#5a2a2a'}" stroke="#0c121f" stroke-width="1"/>
        <polygon points="48,8 88,32 48,56 8,32" fill="url(#base_g)" opacity="0.3"/>
        <defs>
          <linearGradient id="base_g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${owner === 0 ? '#5070b0' : '#b05050'}" stop-opacity="0.7"/>
            <stop offset="100%" stop-color="${owner === 0 ? '#5070b0' : '#b05050'}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <!-- 中央天线 -->
        <rect x="46" y="22" width="4" height="14" fill="#5a5a5a"/>
        <circle cx="48" cy="22" r="3" fill="${owner === 0 ? '#5e8aff' : '#ee5e5e'}" stroke="#0c121f" stroke-width="0.5"/>
        <!-- 房屋方块 -->
        <rect x="22" y="38" width="20" height="14" fill="${owner === 0 ? '#3a4a7a' : '#7a3a3a'}" stroke="#0c121f" stroke-width="0.8" rx="1"/>
        <rect x="56" y="38" width="20" height="14" fill="${owner === 0 ? '#3a4a7a' : '#7a3a3a'}" stroke="#0c121f" stroke-width="0.8" rx="1"/>
        <rect x="25" y="41" width="4" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <rect x="32" y="41" width="4" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <rect x="59" y="41" width="4" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <rect x="66" y="41" width="4" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <rect x="42" y="60" width="12" height="8" fill="${owner === 0 ? '#2a3a6a' : '#6a2a2a'}" stroke="#0c121f" stroke-width="0.6" rx="1"/>
        <!-- 底部基座 -->
        <ellipse cx="48" cy="68" rx="32" ry="8" fill="${owner === 0 ? '#1a243a' : '#3a1a1a'}" opacity="0.8"/>
      </g>`,
    ),
  // 矿场：2×2 footprint
  refinery: (owner: number) =>
    svg(
      96,
      96,
      `<g>
        <polygon points="48,12 84,32 48,52 12,32" fill="${owner === 0 ? '#5e4a2a' : '#5a3a2a'}" stroke="#0c121f" stroke-width="1"/>
        <polygon points="48,12 84,32 48,52 12,32" fill="url(#ref_g)" opacity="0.3"/>
        <defs>
          <linearGradient id="ref_g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#c0a346" stop-opacity="0.7"/>
            <stop offset="100%" stop-color="#c0a346" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <!-- 漏斗/矿斗 -->
        <polygon points="34,30 62,30 56,52 40,52" fill="${owner === 0 ? '#7a6230' : '#7a5240'}" stroke="#0c121f" stroke-width="0.8"/>
        <ellipse cx="48" cy="30" rx="14" ry="3" fill="#0c121f"/>
        <!-- 矿石散落 -->
        <circle cx="40" cy="40" r="2" fill="#e2c660"/>
        <circle cx="48" cy="44" r="2.5" fill="#d6b854"/>
        <circle cx="56" cy="40" r="2" fill="#e2c660"/>
        <circle cx="44" cy="50" r="1.8" fill="#c0a346"/>
        <circle cx="52" cy="50" r="1.8" fill="#c0a346"/>
        <!-- 烟囱 -->
        <rect x="64" y="22" width="5" height="14" fill="#3a3a3a"/>
        <ellipse cx="66.5" cy="22" rx="3" ry="1" fill="#5a5a5a"/>
      </g>`,
    ),
  // 兵营：2×2
  barracks: (owner: number) =>
    svg(
      96,
      96,
      `<g>
        <polygon points="48,12 84,32 48,52 12,32" fill="${owner === 0 ? '#2a4a3a' : '#4a2a3a'}" stroke="#0c121f" stroke-width="1"/>
        <!-- 屋顶 -->
        <polygon points="30,28 66,28 60,40 36,40" fill="${owner === 0 ? '#3a5e4a' : '#5e3a4a'}" stroke="#0c121f" stroke-width="0.6"/>
        <!-- 兵营主体（左右两栋） -->
        <rect x="22" y="40" width="20" height="14" fill="${owner === 0 ? '#3a5e4a' : '#5e3a4a'}" stroke="#0c121f" stroke-width="0.6" rx="1"/>
        <rect x="54" y="40" width="20" height="14" fill="${owner === 0 ? '#3a5e4a' : '#5e3a4a'}" stroke="#0c121f" stroke-width="0.6" rx="1"/>
        <!-- 门 -->
        <rect x="44" y="42" width="8" height="12" fill="${owner === 0 ? '#5a8a6a' : '#8a5a6a'}" stroke="#0c121f" stroke-width="0.5" rx="0.5"/>
        <!-- 窗 -->
        <rect x="26" y="44" width="3" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <rect x="35" y="44" width="3" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <rect x="58" y="44" width="3" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <rect x="67" y="44" width="3" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <!-- 旗杆 -->
        <rect x="32" y="18" width="1.5" height="14" fill="#3a3a3a"/>
        <polygon points="33.5,18 41,20 33.5,22" fill="${owner === 0 ? '#5e94ff' : '#ee5e5e'}"/>
      </g>`,
    ),
  // 工厂：3×3
  factory: (owner: number) =>
    svg(
      96,
      96,
      `<g>
        <polygon points="48,8 88,32 48,56 8,32" fill="${owner === 0 ? '#3a3a5a' : '#5a3a3a'}" stroke="#0c121f" stroke-width="1"/>
        <polygon points="48,8 88,32 48,56 8,32" fill="url(#fac_g)" opacity="0.3"/>
        <defs>
          <linearGradient id="fac_g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${owner === 0 ? '#7a7aaa' : '#aa7a7a'}" stop-opacity="0.7"/>
            <stop offset="100%" stop-color="${owner === 0 ? '#7a7aaa' : '#aa7a7a'}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <!-- 主厂房 -->
        <rect x="22" y="36" width="32" height="18" fill="${owner === 0 ? '#4a4a6a' : '#6a4a4a'}" stroke="#0c121f" stroke-width="0.8" rx="1"/>
        <!-- 锯齿屋顶 -->
        <polygon points="22,36 26,30 30,36 34,30 38,36 42,30 46,36 50,30 54,36" fill="${owner === 0 ? '#3a3a5a' : '#5a3a3a'}" stroke="#0c121f" stroke-width="0.5"/>
        <!-- 副楼 -->
        <rect x="58" y="40" width="20" height="14" fill="${owner === 0 ? '#3a3a5a' : '#5a3a3a'}" stroke="#0c121f" stroke-width="0.6" rx="1"/>
        <!-- 大门 -->
        <rect x="32" y="46" width="12" height="8" fill="#1a1a1a" stroke="#0c121f" stroke-width="0.4"/>
        <line x1="32" y1="50" x2="44" y2="50" stroke="#3a3a3a" stroke-width="0.5"/>
        <!-- 烟囱 -->
        <rect x="62" y="20" width="4" height="14" fill="#3a3a3a"/>
        <ellipse cx="64" cy="20" rx="2.5" ry="1" fill="#5a5a5a"/>
        <!-- 窗 -->
        <rect x="60" y="44" width="3" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <rect x="69" y="44" width="3" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <rect x="60" y="50" width="3" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <rect x="69" y="50" width="3" height="3" fill="${owner === 0 ? '#7ec0ff' : '#ff7e7e'}"/>
        <!-- 车辆（俯视） -->
        <rect x="24" y="62" width="6" height="3" fill="${owner === 0 ? '#3a4a7a' : '#7a3a3a'}" rx="0.5"/>
        <rect x="32" y="62" width="6" height="3" fill="${owner === 0 ? '#3a4a7a' : '#7a3a3a'}" rx="0.5"/>
      </g>`,
    ),
};

/** 给 minimap 用的 1x1 缩略图（色块）。 */
export const MINIMAP_COLORS: Record<Terrain, number> = {
  grass: 0x4a8d56,
  water: 0x3870a8,
  rock: 0x7d7d80,
  ore: 0x9a8b3f,
};

