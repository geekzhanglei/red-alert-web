import Phaser from 'phaser';

/**
 * 预加载所有原创贴图到 Phaser Texture 系统（docs/01-architecture.md 决策三）。
 * 地形、单位和建筑使用可替换的 PNG 资源；Phaser 内部缓存为 Image，渲染层按 key 复用。
 */
export function loadAllSprites(scene: Phaser.Scene): void {
  // 地形（owner 不参与）
  // 原创位图优先；其余地形仍使用 SVG 兜底，便于逐步替换资源。
  scene.load.image('tile_grass', '/assets/original/terrain-grass-v2.png');
  scene.load.image('tile_water', '/assets/original/terrain-water-v2.png');
  scene.load.image('tile_rock', '/assets/original/terrain-rock-v2.png');
  scene.load.image('tile_ore', '/assets/original/terrain-ore-v2.png');
  // 单位（按阵营分 key）
  for (const o of [0, 1]) {
    // 四方向帧按 SE、SW、NW、NE 排列；双方共用材质，渲染层按 owner 加阵营色。
    scene.load.spritesheet(`unit_infantry_${o}`, '/assets/original/unit-infantry-facings-v3.png', UNIT_FACING_SHEET);
    scene.load.spritesheet(`unit_tank_${o}`, '/assets/original/unit-tank-facings-v3.png', UNIT_FACING_SHEET);
    scene.load.spritesheet(`unit_harvester_${o}`, '/assets/original/unit-harvester-facings.png', UNIT_FACING_SHEET);
  }
  // 建筑
  for (const o of [0, 1]) {
    scene.load.image(`bld_base_${o}`, '/assets/original/building-command-center-v2.png');
    scene.load.image(`bld_refinery_${o}`, '/assets/original/building-refinery-v2.png');
    scene.load.image(`bld_barracks_${o}`, '/assets/original/building-barracks-v2.png');
    scene.load.image(`bld_factory_${o}`, '/assets/original/building-factory-v2.png');
  }
}

// 方向图为 512×512 的 2×2 排列，每格依次是 SE、SW、NW、NE。
const UNIT_FACING_SHEET = { frameWidth: 256, frameHeight: 256 };

export function textureKeyFor(typeId: string, owner: number, kind: 'unit' | 'building'): string {
  const prefix = kind === 'unit' ? 'unit' : 'bld';
  return `${prefix}_${typeId}_${owner}`;
}

export const TERRAIN_TEXTURE_KEY: Record<string, string> = {
  grass: 'tile_grass',
  water: 'tile_water',
  rock: 'tile_rock',
  ore: 'tile_ore',
};
