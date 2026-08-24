import type Phaser from 'phaser';
import terrainGrassUrl from './optimized/terrain-grass.webp';
import terrainWaterUrl from './optimized/terrain-water.webp';
import terrainRockUrl from './optimized/terrain-rock.webp';
import terrainOreUrl from './optimized/terrain-ore.webp';
import infantryUrl from './optimized/unit-infantry.webp';
import tankUrl from './optimized/unit-tank.webp';
import harvesterUrl from './optimized/unit-harvester.webp';
import commandCenterUrl from './optimized/building-command-center.webp';
import refineryUrl from './optimized/building-refinery.webp';
import barracksUrl from './optimized/building-barracks.webp';
import factoryUrl from './optimized/building-factory.webp';
import { SPRITES } from './sprites';

// 第一批新增单位/建筑使用内置原创 SVG，先以轻量 data URL 交付，后续可无缝替换为压缩位图。
const rocketTrooperUrl = SPRITES.rocketTrooper;
const scoutUrl = SPRITES.scout;
const artilleryUrl = SPRITES.artillery;
const heavyTankUrl = SPRITES.heavyTank;
const powerPlantUrl = SPRITES.powerPlant();
const guardTowerUrl = SPRITES.guardTower();
const radarUrl = SPRITES.radar();

const RUNTIME_ASSET_URLS = [
  terrainGrassUrl,
  terrainWaterUrl,
  terrainRockUrl,
  terrainOreUrl,
  infantryUrl,
  tankUrl,
  harvesterUrl,
  commandCenterUrl,
  refineryUrl,
  barracksUrl,
  factoryUrl,
  rocketTrooperUrl,
  scoutUrl,
  artilleryUrl,
  heavyTankUrl,
  powerPlantUrl,
  guardTowerUrl,
  radarUrl,
];

let warmedImages: HTMLImageElement[] | null = null;

/** 菜单空闲时预热浏览器图片缓存；Phaser 随后会复用相同 URL，不重复下载。 */
export function warmSpriteCache(): void {
  if (warmedImages) return;
  warmedImages = RUNTIME_ASSET_URLS.map((url) => {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    return image;
  });
}

/**
 * 预加载所有原创贴图到 Phaser Texture 系统（docs/01-architecture.md 决策三）。
 * 地形、单位和建筑使用可替换的 PNG 资源；Phaser 内部缓存为 Image，渲染层按 key 复用。
 */
export function loadAllSprites(scene: Phaser.Scene): void {
  // 地形（owner 不参与）
  // 原创位图优先；其余地形仍使用 SVG 兜底，便于逐步替换资源。
  scene.load.image('tile_grass', terrainGrassUrl);
  scene.load.image('tile_water', terrainWaterUrl);
  scene.load.image('tile_rock', terrainRockUrl);
  scene.load.image('tile_ore', terrainOreUrl);
  // 单位（按阵营分 key）
  for (const o of [0, 1]) {
    // 四方向帧按 SE、SW、NW、NE 排列；双方共用材质，渲染层按 owner 加阵营色。
    scene.load.spritesheet(`unit_infantry_${o}`, infantryUrl, UNIT_FACING_SHEET);
    scene.load.spritesheet(`unit_tank_${o}`, tankUrl, UNIT_FACING_SHEET);
    scene.load.spritesheet(`unit_harvester_${o}`, harvesterUrl, UNIT_FACING_SHEET);
    scene.load.spritesheet(`unit_rocketTrooper_${o}`, rocketTrooperUrl, UNIT_FACING_SHEET);
    scene.load.spritesheet(`unit_scout_${o}`, scoutUrl, UNIT_FACING_SHEET);
    scene.load.spritesheet(`unit_artillery_${o}`, artilleryUrl, UNIT_FACING_SHEET);
    scene.load.spritesheet(`unit_heavyTank_${o}`, heavyTankUrl, UNIT_FACING_SHEET);
  }
  // 建筑
  for (const o of [0, 1]) {
    scene.load.image(`bld_base_${o}`, commandCenterUrl);
    scene.load.image(`bld_refinery_${o}`, refineryUrl);
    scene.load.image(`bld_barracks_${o}`, barracksUrl);
    scene.load.image(`bld_factory_${o}`, factoryUrl);
    scene.load.image(`bld_powerPlant_${o}`, powerPlantUrl);
    scene.load.image(`bld_guardTower_${o}`, guardTowerUrl);
    scene.load.image(`bld_radar_${o}`, radarUrl);
  }
}

// 运行时方向图优化为 256×256 的 2×2 排列，每格依次是 SE、SW、NW、NE。
const UNIT_FACING_SHEET = { frameWidth: 128, frameHeight: 128 };

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
