import Phaser from 'phaser';
import { SPRITES } from './sprites';

/**
 * 预加载所有原创 SVG 贴图到 Phaser Texture 系统（docs/01-architecture.md 决策三）。
 * data: URL 形式：避免落盘 + 构建，源在 TS 里，运行时按 key 解析一次。
 * Phaser 内部缓为 Image；后续渲染用 scene.add.image(key)。
 */
export function loadAllSprites(scene: Phaser.Scene): void {
  // 地形（owner 不参与）
  // 原创位图优先；其余地形仍使用 SVG 兜底，便于逐步替换资源。
  scene.load.image('tile_grass', '/assets/original/terrain-grass.png');
  scene.load.image('tile_water', SPRITES.water);
  scene.load.image('tile_rock', SPRITES.rock);
  scene.load.image('tile_ore', SPRITES.ore);
  // 单位（按阵营分 key）
  for (const o of [0, 1]) {
    // 双方共用同一套原创工业材质；渲染层按 owner 加阵营色，避免敌方回退到旧 SVG。
    scene.load.image(`unit_infantry_${o}`, '/assets/original/unit-infantry.png');
    scene.load.image(`unit_tank_${o}`, '/assets/original/unit-tank.png');
    scene.load.image(`unit_harvester_${o}`, '/assets/original/unit-harvester.png');
  }
  // 建筑
  for (const o of [0, 1]) {
    scene.load.image(`bld_base_${o}`, '/assets/original/building-command-center.png');
    scene.load.image(`bld_refinery_${o}`, '/assets/original/building-refinery.png');
    scene.load.image(`bld_barracks_${o}`, '/assets/original/building-barracks.png');
    scene.load.image(`bld_factory_${o}`, '/assets/original/building-factory.png');
  }
}

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
