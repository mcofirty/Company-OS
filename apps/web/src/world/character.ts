import * as THREE from 'three';
import type { Appearance } from './studio';

/**
 * Personnage 3D partagé (carte du QG et portrait de la fiche) : tenue aux couleurs du pôle et
 * expressions (neutre, concentré, content, inquiet). Uniquement de la géométrie simple : léger.
 */
export type Mood = 'neutral' | 'focus' | 'happy' | 'worried';

export interface Character {
  g: THREE.Group;
  body: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  setMood(m: Mood): void;
  mood: Mood;
}

const GEOS = new Map<string, THREE.BufferGeometry>();
const geo = <T extends THREE.BufferGeometry>(k: string, f: () => T): T => {
  let g = GEOS.get(k) as T | undefined;
  if (!g) GEOS.set(k, (g = f()));
  return g;
};
const B = (w: number, h: number, d: number) =>
  geo(`b${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
const S = (r: number) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 16, 12));
const K = (r: number, l: number) => geo(`k${r}:${l}`, () => new THREE.CapsuleGeometry(r, l, 5, 12));
const C = (r: number, h: number) =>
  geo(`c${r}:${h}`, () => new THREE.CylinderGeometry(r, r, h, 10));

function add(
  g: THREE.BufferGeometry,
  m: THREE.Material,
  x: number,
  y: number,
  z: number,
  parent: THREE.Object3D,
): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

/** Couleur de tenue : la couleur du pôle, nuancée par personne (reconnaissable de loin). */
export function outfitColor(deptColor: string | null, fallback: string, seed: number): string {
  if (!deptColor) return fallback;
  const c = new THREE.Color(deptColor);
  c.offsetHSL(0, -0.05, ((seed % 5) - 2) * 0.045 - 0.04);
  return `#${c.getHexString()}`;
}

export function buildCharacter(ap: Appearance, top: string): Character {
  const mats: THREE.MeshStandardMaterial[] = [];
  const m = (c: string, r = 0.85): THREE.MeshStandardMaterial => {
    const x = new THREE.MeshStandardMaterial({ color: c, roughness: r });
    mats.push(x);
    return x;
  };
  const skin = m(ap.skin, 0.7);
  const shirt = m(top);
  const pants = m(ap.pants);
  const hair = m(ap.hair, 0.9);
  const shoe = m('#2a2522', 0.6);
  const dark = m('#1d1a18', 0.4);
  const badge = m('#f4f4f4', 0.5);
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.085, 0.53, 0);
  legR.position.set(0.085, 0.53, 0);
  for (const l of [legL, legR]) {
    add(K(0.072, 0.36), pants, 0, -0.25, 0, l);
    add(B(0.12, 0.07, 0.2), shoe, 0, -0.5, 0.04, l);
    body.add(l);
  }
  add(K(0.165, 0.28), shirt, 0, 0.82, 0, body).scale.set(1, 1, 0.72);
  // Badge d'entreprise (tour de cou) : détail « bureau ».
  add(B(0.06, 0.08, 0.01), badge, 0.07, 0.8, 0.125, body);
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.215, 1.0, 0);
  armR.position.set(0.215, 1.0, 0);
  for (const a of [armL, armR]) {
    add(K(0.052, 0.32), shirt, 0, -0.19, 0, a);
    add(S(0.05), skin, 0, -0.4, 0, a);
    body.add(a);
  }
  const head = new THREE.Group();
  head.position.y = 1.25;
  body.add(head);
  add(S(0.13), skin, 0, 0, 0, head);
  add(C(0.05, 0.08), skin, 0, -0.13, 0, head);
  add(
    geo('hair', () => new THREE.SphereGeometry(0.138, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)),
    hair,
    0,
    0.012,
    -0.008,
    head,
  ).rotation.x = -0.25;
  if (ap.style === 1) add(K(0.11, 0.14), hair, 0, -0.1, -0.07, head).scale.set(1.1, 1, 0.6);
  if (ap.style === 2) add(S(0.06), hair, 0, 0.08, -0.14, head);
  add(S(0.017), dark, -0.045, 0.01, 0.122, head);
  add(S(0.017), dark, 0.045, 0.01, 0.122, head);
  // Sourcils et bouche : les expressions.
  const browL = add(B(0.045, 0.009, 0.01), hair, -0.045, 0.05, 0.123, head);
  const browR = add(B(0.045, 0.009, 0.01), hair, 0.045, 0.05, 0.123, head);
  const arc = geo('mouth', () => new THREE.TorusGeometry(0.03, 0.007, 6, 14, Math.PI));
  const smile = add(arc, dark, 0, -0.045, 0.118, head);
  smile.rotation.z = Math.PI; // arc vers le bas : sourire
  const frown = add(arc, dark, 0, -0.065, 0.118, head);
  const flat = add(B(0.045, 0.007, 0.01), dark, 0, -0.05, 0.122, head);
  const ch: Character = {
    g,
    body,
    legL,
    legR,
    armL,
    armR,
    head,
    mats,
    mood: 'neutral',
    setMood(mood: Mood) {
      ch.mood = mood;
      smile.visible = mood === 'happy' || mood === 'neutral';
      smile.scale.setScalar(mood === 'happy' ? 1.15 : 0.7);
      frown.visible = mood === 'worried';
      flat.visible = mood === 'focus';
      // Concentré : sourcils froncés ; inquiet : sourcils relevés au centre ; content : hauts.
      const tilt = mood === 'focus' ? 0.35 : mood === 'worried' ? -0.4 : 0;
      browL.rotation.z = -tilt;
      browR.rotation.z = tilt;
      const y = mood === 'happy' ? 0.058 : mood === 'focus' ? 0.044 : 0.05;
      browL.position.y = y;
      browR.position.y = y;
    },
  };
  ch.setMood('neutral');
  return ch;
}
