import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { isHub, LOOSE, type BrainModel, type BrainNode } from './brain-model';

interface SceneNode extends Omit<BrainNode, 'lobe'> {
  lobe: SceneNode | null;
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
  base: number;
  bright: number;
}
interface Edge {
  a: SceneNode;
  b: SceneNode;
  w: number;
  next: number;
  curve: THREE.QuadraticBezierCurve3;
}
interface Pulse {
  e: Edge;
  p: number;
  dir: boolean;
  sp: number;
  faint?: boolean;
}
export interface LabelAnchor {
  index: number;
  x: number;
  y: number;
  visible: boolean;
  depthFade: number;
}

/** The approved point, curve and impulse scene, scoped to one view. */
export class BrainScene {
  onHover: (index: number | null, screen: { x: number; y: number }) => void = () => {};
  onOpen: (index: number, newTab: boolean) => void = () => {};
  /** Runs even while paused so the view can detect becoming visible again. */
  onFrame: () => void = () => {};
  private paused = false;
  private disposed = false;
  private animation = 0;
  private cleanup: (() => void)[] = [];
  private anchors: () => LabelAnchor[] = () => [];
  private sizeScene: (width: number, height: number) => void = () => {};

  constructor(container: HTMLElement, model: BrainModel, positions: Float32Array) {
    try {
      this.initialize(container, model, positions);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private initialize(container: HTMLElement, model: BrainModel, positions: Float32Array): void {
    if (positions.length !== model.nodes.length * 3 || !positions.every(Number.isFinite)) {
      throw new Error('Invalid brain positions');
    }
    const width = Math.max(1, container.clientWidth),
      height = Math.max(1, container.clientHeight);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    this.cleanup.push(() => {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    });
    renderer.setPixelRatio(Math.min(container.ownerDocument.defaultView?.devicePixelRatio ?? 1, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000);
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.0011);
    scene.background = new THREE.Color(0x020309);
    const camera = new THREE.PerspectiveCamera(42, width / height, 1, 5000);
    camera.position.set(-215, 80, 215);
    const controls = new OrbitControls(camera, renderer.domElement);
    this.cleanup.push(() => controls.dispose());
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.45;
    controls.minDistance = 120;
    controls.maxDistance = 1100;
    controls.target.set(0, -5, 0);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
    let idle = 0,
      interacting = false;
    const start = () => {
      controls.autoRotate = false;
      idle = 0;
      interacting = true;
    };
    const end = () => {
      idle = 0;
      interacting = false;
    };
    controls.addEventListener('start', start);
    controls.addEventListener('end', end);
    this.cleanup.push(() => {
      controls.removeEventListener('start', start);
      controls.removeEventListener('end', end);
    });
    const composer = new EffectComposer(renderer);
    this.cleanup.push(() => composer.dispose());
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    this.cleanup.push(() => renderPass.dispose());
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.42, 0.18);
    composer.addPass(bloom);
    // r160's pass omits its high-pass material from dispose().
    this.cleanup.push(() => {
      bloom.materialHighPassFilter.dispose();
      bloom.dispose();
    });
    const output = new OutputPass();
    composer.addPass(output);
    this.cleanup.push(() => output.dispose());

    let seed = 20261030;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    // Replay the draws used for trail timers and initial layout positions.
    for (let i = 0; i < model.trails.length + model.nodes.length * 3; i++) rand();
    const nodes = model.nodes.map(
      (n, i) =>
        ({
          ...n,
          lobe: null,
          x: positions[i * 3],
          y: positions[i * 3 + 1],
          z: positions[i * 3 + 2],
          color: new THREE.Color(),
          base: 0,
          bright: 0,
        }) as SceneNode
    );
    nodes.forEach((n, i) => {
      const lobe = model.nodes[i].lobe;
      n.lobe = lobe ? nodes[lobe.i] : null;
    });
    const loose = new THREE.Color(LOOSE);
    const lobeColor = new Map(
      model.lobesBySize.map(h => [nodes[h.i], new THREE.Color(model.lobeColor.get(h)!)])
    );
    const nbrs = new Map(
      nodes.map(n => [
        n,
        new Set([...model.neighbours.get(model.nodes[n.i])!].map(other => nodes[other.i])),
      ])
    );
    const maxW = Math.max(1, ...model.trails.map(t => t.w));
    const lobesBySize = model.lobesBySize.map(h => nodes[h.i]);

    const N = nodes.length;
    const pos = positions.slice(),
      col = new Float32Array(N * 3),
      size = new Float32Array(N),
      alpha = new Float32Array(N);
    nodes.forEach(n => {
      const heatT = Math.min(1, n.heat / 4 + n.score / 30);
      n.base = isHub(n) ? 26 + Math.sqrt(n.deg) * 1.6 : 9 + Math.sqrt(n.deg) * 1.1 + heatT * 8;
      n.color = (n.lobe ? lobeColor.get(n.lobe)! : loose)
        .clone()
        .lerp(new THREE.Color('#ffffff'), isHub(n) ? 0.35 : heatT * 0.25);
      n.bright = isHub(n)
        ? 1
        : n.type === 'journal' || n.type === 'inbox'
          ? 0.35
          : 0.5 + heatT * 0.5;
    });
    const ng = new THREE.BufferGeometry();
    this.cleanup.push(() => ng.dispose());
    ng.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    ng.setAttribute('size', new THREE.BufferAttribute(size, 1));
    ng.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const pointMat = (soft: boolean) =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uPR: { value: renderer.getPixelRatio() }, uTime: { value: 0 } },
        vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uPR; uniform float uTime;
    void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); float br = 1.0 + 0.06*sin(uTime*1.2 + position.x*0.05 + position.z*0.04);
      gl_PointSize = size * br * uPR * (320.0 / -mv.z); vC = color; vA = alpha; gl_Position = projectionMatrix*mv; }`,
        fragmentShader: soft
          ? `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = (exp(-d*d*14.0)*0.35 + exp(-d*d*60.0)*0.75) * smoothstep(0.5, 0.28, d); if (a < 0.002) discard; gl_FragColor = vec4(vC*a*vA, 1.0); }`
          : `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = exp(-d*d*28.0) * smoothstep(0.5, 0.3, d); if (a < 0.002) discard; gl_FragColor = vec4(vC*a*vA, 1.0); }`,
      });
    const neuronMat = pointMat(true);
    this.cleanup.push(() => neuronMat.dispose());
    const neurons = new THREE.Points(ng, neuronMat);
    scene.add(neurons);

    const SEG = 10;
    const curve = (a: SceneNode, b: SceneNode, bendSeed: number) => {
      const m = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      m.multiplyScalar(0.82 + bendSeed * 0.1);
      return new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(a.x, a.y, a.z),
        m,
        new THREE.Vector3(b.x, b.y, b.z)
      );
    };
    const links: Edge[] = model.links.map(e => ({
      a: nodes[e.a.i],
      b: nodes[e.b.i],
      w: 0,
      next: 0,
      curve: curve(nodes[e.a.i], nodes[e.b.i], rand()),
    }));
    const trails: Edge[] = model.trails.map(e => ({
      a: nodes[e.a.i],
      b: nodes[e.b.i],
      w: e.w,
      next: e.next,
      curve: curve(nodes[e.a.i], nodes[e.b.i], rand()),
    }));
    const lineBuffer = (edges: Edge[]) => {
      const p = new Float32Array(edges.length * SEG * 2 * 3),
        c = new Float32Array(p.length);
      edges.forEach((e, k) => {
        const pts = e.curve.getPoints(SEG);
        for (let s = 0; s < SEG; s++)
          p.set(
            [pts[s].x, pts[s].y, pts[s].z, pts[s + 1].x, pts[s + 1].y, pts[s + 1].z],
            (k * SEG + s) * 6
          );
      });
      const g = new THREE.BufferGeometry();
      this.cleanup.push(() => g.dispose());
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.cleanup.push(() => material.dispose());
      return new THREE.LineSegments(g, material);
    };
    const dendrites = lineBuffer(links);
    scene.add(dendrites);
    const synapses = lineBuffer(trails);
    scene.add(synapses);

    const MAXP = 600,
      pp = new Float32Array(MAXP * 3),
      pc = new Float32Array(MAXP * 3),
      ps = new Float32Array(MAXP),
      pa = new Float32Array(MAXP);
    const pg = new THREE.BufferGeometry();
    this.cleanup.push(() => pg.dispose());
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    pg.setAttribute('size', new THREE.BufferAttribute(ps, 1));
    pg.setAttribute('alpha', new THREE.BufferAttribute(pa, 1));
    const pulseMat = pointMat(false);
    this.cleanup.push(() => pulseMat.dispose());
    scene.add(new THREE.Points(pg, pulseMat));
    const pulses: Pulse[] = [];
    let hover: SceneNode | null = null;
    const applyColours = () => {
      const focus = hover ? nbrs.get(hover)! : null;
      nodes.forEach((n, i) => {
        const on = !focus || n === hover || focus.has(n);
        const k = n === hover ? 2.6 : focus && on ? 1.7 : 1;
        col.set([n.color.r, n.color.g, n.color.b], i * 3);
        size[i] = n.base * (n === hover ? 2.2 : focus && on ? 1.35 : 1);
        alpha[i] = on ? Math.min(1.9, n.bright * k * 0.65) : n.bright * 0.06;
      });
      ['color', 'size', 'alpha'].forEach(a => {
        ng.attributes[a].needsUpdate = true;
      });
      const paint = (
        lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>,
        edges: Edge[],
        base: number[],
        hi: number[]
      ) => {
        const c = lines.geometry.attributes.color.array;
        edges.forEach((e, k) => {
          const on = hover && (e.a === hover || e.b === hover);
          const w = e.w ? 0.35 + (0.65 * e.w) / maxW : 1;
          const tint = on ? hi : base,
            m = (focus ? (on ? 1 : 0.08) : 1) * w;
          const ca = e.a.lobe ? lobeColor.get(e.a.lobe)! : loose;
          for (let s = 0; s < SEG * 2; s++)
            c.set(
              [
                (tint[0] * 0.6 + ca.r * tint[3]) * m,
                (tint[1] * 0.6 + ca.g * tint[3]) * m,
                (tint[2] * 0.6 + ca.b * tint[3]) * m,
              ],
              (k * SEG * 2 + s) * 3
            );
        });
        lines.geometry.attributes.color.needsUpdate = true;
      };
      paint(dendrites, links, [0.02, 0.024, 0.05, 0.03], [0.4, 0.48, 0.8, 0.4]);
      paint(synapses, trails, [0.04, 0.16, 0.15, 0.07], [0.4, 1, 0.9, 0.4]);
    };
    applyColours();

    const ray = new THREE.Raycaster(),
      mouse = new THREE.Vector2(-9, -9);
    let mx = 0,
      my = 0;
    let downAt: { x: number; y: number; id: number; moved: boolean } | null = null;
    const pointAt = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect(),
        outer = container.getBoundingClientRect();
      mx = e.clientX - outer.left;
      my = e.clientY - outer.top;
      mouse.set(
        ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
    };
    const pick = () => {
      ray.setFromCamera(mouse, camera);
      ray.params.Points!.threshold = 6;
      const hit = ray.intersectObject(neurons)[0];
      const n = hit?.index === undefined ? null : (nodes[hit.index] ?? null);
      if (n !== hover) {
        hover = n;
        applyColours();
        container.classList.toggle('hovering', !!n);
        if (n) {
          controls.autoRotate = false;
          idle = 0;
        }
      }
      this.onHover(hover?.i ?? null, { x: mx, y: my });
    };
    const move = (e: PointerEvent) => {
      pointAt(e);
      if (
        downAt &&
        e.pointerId === downAt.id &&
        Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) >= 4
      )
        downAt.moved = true;
    };
    const leave = () => {
      mouse.set(-9, -9);
    };
    const down = (e: PointerEvent) => {
      pointAt(e);
      downAt = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    };
    const cancel = () => {
      downAt = null;
    };
    const up = (e: PointerEvent) => {
      pointAt(e);
      pick();
      if (
        downAt &&
        e.pointerId === downAt.id &&
        !downAt.moved &&
        Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4 &&
        hover
      ) {
        this.onOpen(hover.i, e.metaKey || e.ctrlKey);
      }
      downAt = null;
    };
    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('lostpointercapture', cancel);
    this.cleanup.push(() => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('lostpointercapture', cancel);
      container.classList.remove('hovering');
    });
    const v = new THREE.Vector3();
    let sceneWidth = width,
      sceneHeight = height;
    this.anchors = () =>
      lobesBySize.slice(0, 14).map(h => {
        v.set(h.x, h.y + 10, h.z).project(camera);
        const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        const depth = new THREE.Vector3(h.x, h.y, h.z).distanceTo(camera.position);
        return {
          index: h.i,
          x: ((v.x + 1) / 2) * sceneWidth,
          y: ((1 - v.y) / 2) * sceneHeight,
          visible,
          depthFade: Math.max(0.25, Math.min(1, 1.6 - depth / 450)),
        };
      });
    this.sizeScene = (newWidth, newHeight) => {
      sceneWidth = Math.max(1, newWidth);
      sceneHeight = Math.max(1, newHeight);
      camera.aspect = sceneWidth / sceneHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(sceneWidth, sceneHeight);
      composer.setSize(sceneWidth, sceneHeight);
    };
    let last = performance.now(),
      elapsed = 0;
    const frame = () => {
      if (this.disposed) return;
      this.onFrame();
      if (this.disposed) return;
      const now = performance.now(),
        dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!this.paused) {
        elapsed += dt;
        idle += dt;
        if (!controls.autoRotate && idle > 8 && !hover && !interacting) controls.autoRotate = true;
        controls.update();
        neuronMat.uniforms.uTime.value = elapsed;
        pick();
        for (const tr of trails) {
          tr.next -= dt;
          if (tr.next <= 0 && pulses.length < MAXP) {
            pulses.push({ e: tr, p: 0, dir: rand() < 0.5, sp: 0.3 + rand() * 0.2 });
            tr.next = (5 / (0.4 + (tr.w / maxW) * 3)) * (0.6 + rand() * 0.8);
          }
        }
        if (rand() < dt * 5 && pulses.length < MAXP && links.length) {
          const l = links[(rand() * links.length) | 0];
          pulses.push({ e: l, p: 0, dir: rand() < 0.5, sp: 0.45, faint: true });
        }
        let k = 0;
        for (let i = pulses.length - 1; i >= 0; i--) {
          const q = pulses[i];
          q.p += dt * q.sp;
          if (q.p >= 1) {
            pulses.splice(i, 1);
            continue;
          }
          q.e.curve.getPoint(q.dir ? q.p : 1 - q.p, v);
          const lit = hover && (q.e.a === hover || q.e.b === hover);
          const c = q.faint ? [0.5, 0.6, 1] : [0.6, 1, 0.92];
          pp.set([v.x, v.y, v.z], k * 3);
          pc.set(c, k * 3);
          ps[k] = (q.faint ? 5 : 9) * (lit ? 1.6 : 1);
          pa[k] = (hover && !lit ? 0.08 : q.faint ? 0.25 : 0.7) * Math.sin(q.p * Math.PI);
          k++;
        }
        for (let j = k; j < MAXP; j++) pa[j] = 0;
        pg.setDrawRange(0, k);
        ['position', 'color', 'size', 'alpha'].forEach(a => {
          pg.attributes[a].needsUpdate = true;
        });
        composer.render();
      }
      this.animation = requestAnimationFrame(frame);
    };
    this.animation = requestAnimationFrame(frame);
  }

  labelAnchors(): LabelAnchor[] {
    return this.anchors();
  }
  setPaused(paused: boolean): void {
    this.paused = paused;
  }
  resize(width: number, height: number): void {
    if (!this.disposed) this.sizeScene(width, height);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    for (const cleanup of this.cleanup.reverse()) cleanup();
    this.cleanup = [];
    this.anchors = () => [];
    this.sizeScene = () => {};
    this.onHover = () => {};
    this.onOpen = () => {};
    this.onFrame = () => {};
  }
}
