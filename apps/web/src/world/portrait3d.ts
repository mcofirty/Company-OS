import * as THREE from 'three';
import { buildCharacter, outfitColor, type Mood } from './character';
import { appearanceOf, hash } from './studio';

/**
 * Portrait 3D d'un agent (même personnage que sur la carte), rendu UNE fois dans un moteur
 * hors écran partagé puis mis en cache en image : aucune animation, aucune charge continue.
 */
let renderer: THREE.WebGLRenderer | null = null;
let failed = false;
const cache = new Map<string, string>();

function engine(): THREE.WebGLRenderer | null {
  if (renderer || failed) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(256, 256, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  } catch {
    failed = true;
  }
  return renderer;
}

export function portraitDataUrl(
  avatarId: string,
  agentId: string,
  deptColor: string | null,
  mood: Mood,
  crop: 'bust' | 'head' = 'bust',
): string | null {
  const key = `${avatarId}|${agentId}|${deptColor}|${mood}|${crop}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = engine();
  if (!r) return null;
  const ap = appearanceOf(avatarId);
  const ch = buildCharacter(ap, outfitColor(deptColor, ap.top, hash(agentId)));
  ch.setMood(mood);
  // Pose de portrait : légère rotation, bras le long du corps.
  ch.g.rotation.y = -0.35;
  if (mood === 'happy') {
    ch.armR.rotation.x = -2.4;
    ch.armR.rotation.z = 0.3;
  }
  const scene = new THREE.Scene();
  scene.add(ch.g);
  scene.add(new THREE.HemisphereLight('#fffaf2', '#cbb79d', 2.2));
  const key1 = new THREE.DirectionalLight('#fff3e0', 2.4);
  key1.position.set(1.5, 2.5, 2.5);
  scene.add(key1);
  const cam = new THREE.PerspectiveCamera(crop === 'head' ? 18 : 26, 1, 0.1, 20);
  const focusY = crop === 'head' ? 1.25 : 1.0;
  cam.position.set(0.25, focusY + 0.12, crop === 'head' ? 1.3 : 2.3);
  cam.lookAt(0, focusY, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  ch.mats.forEach((m) => m.dispose());
  cache.set(key, url);
  return url;
}
