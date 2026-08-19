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
    scene.load.image(`unit_infantry_${o}`, SPRITES.infantry(o));
    scene.load.image(`unit_tank_${o}`, o === 0 ? '/assets/original/unit-tank.png' : SPRITES.tank(o));
    scene.load.image(`unit_harvester_${o}`, SPRITES.harvester(o));
  }
  // 建筑
  for (const o of [0, 1]) {
    scene.load.image(`bld_base_${o}`, o === 0 ? '/assets/original/building-command-center.png' : SPRITES.base(o));
    scene.load.image(`bld_refinery_${o}`, o === 0 ? '/assets/original/building-refinery.png' : SPRITES.refinery(o));
    scene.load.image(`bld_barracks_${o}`, o === 0 ? '/assets/original/building-barracks.png' : SPRITES.barracks(o));
    scene.load.image(`bld_factory_${o}`, o === 0 ? '/assets/original/building-factory.png' : SPRITES.factory(o));
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
