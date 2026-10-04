/**
 * scaffold/demos.ts
 * ─────────────────
 * Páginas de demostración para las librerías visuales (Three.js, GSAP, p5.js, Phaser,
 * Leaflet, React Three Fiber). Así quien no sabe programar ve algo funcionando nada más
 * crear el proyecto y tiene un ejemplo que copiar.
 *
 * Solo se crean en proyectos Vite: Vite sirve cualquier .html del proyecto, así que
 * cada demo se abre en http://localhost:5173/demos/<nombre>.html sin tocar nada más.
 * El código de las plantillas (`...`) es el que se escribe en el proyecto del usuario.
 */
import * as fs from 'fs';
import * as path from 'path';
import { write } from './files';

/**
 * ¿Es un proyecto Vite? (tiene index.html en la raíz, a diferencia de Angular, Next o Astro).
 * @param dir carpeta del proyecto
 */
export function isViteProject(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'package.json'));
}

/**
 * HTML de una página de demo.
 * @param title título de la pestaña
 * @param script fichero JS de la demo (relativo a demos/)
 * @param head etiquetas extra para <head>
 */
function demoPage(title: string, script: string, head = ''): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} · DevStarter demo</title>
    <style>
      html, body { margin: 0; height: 100%; background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; overflow: hidden; }
      .back { position: fixed; top: 12px; left: 12px; z-index: 10; color: #a5b4fc; text-decoration: none; font-size: 14px; }
    </style>
${head}  </head>
  <body>
    <a class="back" href="./index.html">← all demos</a>
    <script type="module" src="./${script}"></script>
  </body>
</html>
`;
}

/** Escribe demos/three.html: un nudo 3D que gira, con luces. */
export function writeThreeDemo(dir: string): void {
    write(path.join(dir, 'demos', 'three.html'), demoPage('Three.js', 'three.js'));
    write(
        path.join(dir, 'demos', 'three.js'),
        `
import * as THREE from 'three'

// Every Three.js app needs three things: a scene, a camera and a renderer.
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0f172a)
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100)
camera.position.z = 4

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(devicePixelRatio)
document.body.appendChild(renderer.domElement)

// A shape (geometry) + how it looks (material) = a mesh.
const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(1, 0.32, 200, 32),
  new THREE.MeshStandardMaterial({ color: 0x818cf8, metalness: 0.3, roughness: 0.25 }),
)
scene.add(knot)

// Lights, so the material is visible.
scene.add(new THREE.AmbientLight(0xffffff, 0.5))
const light = new THREE.DirectionalLight(0xffffff, 2.5)
light.position.set(3, 3, 5)
scene.add(light)

// Move the mouse to tilt the shape.
let mouseX = 0
let mouseY = 0
addEventListener('pointermove', (event) => {
  mouseX = event.clientX / innerWidth - 0.5
  mouseY = event.clientY / innerHeight - 0.5
})

// This runs about 60 times per second.
renderer.setAnimationLoop(() => {
  knot.rotation.x += 0.01 + mouseY * 0.05
  knot.rotation.y += 0.015 + mouseX * 0.05
  renderer.render(scene, camera)
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
`,
    );
}

/** Escribe demos/gsap.html: cajas que entran en escena con una línea de tiempo. */
export function writeGsapDemo(dir: string): void {
    write(
        path.join(dir, 'demos', 'gsap.html'),
        demoPage(
            'GSAP',
            'gsap.js',
            `    <style>
      .stage { height: 100%; display: flex; align-items: center; justify-content: center; gap: 16px; }
      .box { width: 80px; height: 80px; border-radius: 16px; background: linear-gradient(135deg, #2dd4bf, #818cf8, #e879f9); }
      h1 { position: fixed; bottom: 40px; width: 100%; text-align: center; font-size: 28px; }
    </style>
`,
        ),
    );
    write(
        path.join(dir, 'demos', 'gsap.js'),
        `
import { gsap } from 'gsap'

// Build the page: five boxes and a title.
document.body.insertAdjacentHTML(
  'beforeend',
  '<div class="stage">' + '<div class="box"></div>'.repeat(5) + '</div><h1>Animated with GSAP</h1>',
)

// A timeline plays animations one after another.
const timeline = gsap.timeline({ repeat: -1, repeatDelay: 0.5, yoyo: true })
timeline
  .from('.box', { y: -200, opacity: 0, rotation: 180, stagger: 0.12, duration: 0.8, ease: 'back.out(1.7)' })
  .to('.box', { scale: 1.3, borderRadius: '50%', stagger: 0.08, duration: 0.4 })
  .from('h1', { opacity: 0, y: 30, duration: 0.6 }, '<')
`,
    );
}

/** Escribe demos/p5.html: círculos de colores que siguen al ratón. */
export function writeP5Demo(dir: string): void {
    write(path.join(dir, 'demos', 'p5.html'), demoPage('p5.js', 'p5.js'));
    write(
        path.join(dir, 'demos', 'p5.js'),
        `
import p5 from 'p5'

// p5.js calls setup() once and draw() about 60 times per second.
new p5((p) => {
  const trail = []
  let lastMove = -Infinity

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight)
    p.colorMode(p.HSB)
    p.noStroke()
  }

  // Remember when the mouse last moved.
  p.mouseMoved = () => {
    lastMove = p.millis()
  }

  p.draw = () => {
    p.background(230, 60, 10, 0.25)
    // Follow the mouse; if it is still, draw a looping figure by itself.
    const t = p.millis() / 1000
    const usingMouse = p.millis() - lastMove < 2000
    const x = usingMouse ? p.mouseX : p.width / 2 + Math.sin(t * 1.3) * p.width * 0.3
    const y = usingMouse ? p.mouseY : p.height / 2 + Math.sin(t * 2.1) * p.height * 0.3
    trail.push({ x, y, hue: p.frameCount % 360 })
    if (trail.length > 60) {
      trail.shift()
    }
    trail.forEach((dot, i) => {
      p.fill(dot.hue, 70, 100, 0.8)
      p.circle(dot.x, dot.y, i)
    })
  }

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight)
})
`,
    );
}

/** Escribe demos/phaser.html: un minijuego con bolas que rebotan (haz clic para crear más). */
export function writePhaserDemo(dir: string): void {
    write(path.join(dir, 'demos', 'phaser.html'), demoPage('Phaser', 'phaser.js'));
    write(
        path.join(dir, 'demos', 'phaser.js'),
        `
import Phaser from 'phaser'

// A Phaser game is made of scenes. Each scene has preload, create and update.
class BounceScene extends Phaser.Scene {
  create() {
    // Draw a ball texture once and reuse it (no image files needed).
    const graphics = this.make.graphics({ x: 0, y: 0, add: false })
    graphics.fillStyle(0x818cf8).fillCircle(16, 16, 16)
    graphics.generateTexture('ball', 32, 32)

    this.balls = this.physics.add.group({ bounceX: 1, bounceY: 0.9, collideWorldBounds: true })
    this.add.text(16, 48, 'Click to add balls!', { fontSize: '20px', color: '#e2e8f0' })

    this.input.on('pointerdown', (pointer) => this.addBall(pointer.x, pointer.y))
    for (let i = 0; i < 5; i++) {
      this.addBall(Phaser.Math.Between(100, 700), 100)
    }
  }

  addBall(x, y) {
    const ball = this.balls.create(x, y, 'ball')
    ball.setVelocity(Phaser.Math.Between(-300, 300), Phaser.Math.Between(-200, 0))
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#0f172a',
  physics: { default: 'arcade', arcade: { gravity: { y: 400 } } },
  scene: BounceScene,
})
`,
    );
}

/** Escribe demos/leaflet.html: un mapa interactivo con un marcador. */
export function writeLeafletDemo(dir: string): void {
    write(
        path.join(dir, 'demos', 'leaflet.html'),
        demoPage('Leaflet', 'leaflet.js', '    <style>#map { height: 100%; }</style>\n'),
    );
    write(
        path.join(dir, 'demos', 'leaflet.js'),
        `
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

document.body.insertAdjacentHTML('beforeend', '<div id="map"></div>')

// Center the map on Madrid (latitude, longitude) with zoom level 13.
const map = L.map('map').setView([40.4168, -3.7038], 13)

// The map images ("tiles") come from OpenStreetMap.
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map)

L.marker([40.4168, -3.7038]).addTo(map).bindPopup('Hello from DevStarter!').openPopup()

// Click anywhere to drop a marker.
map.on('click', (event) => {
  L.marker(event.latlng).addTo(map).bindPopup(\`\${event.latlng.lat.toFixed(4)}, \${event.latlng.lng.toFixed(4)}\`)
})
`,
    );
}

/** Escribe demos/fiber.html: una escena de React Three Fiber (solo proyectos React). */
export function writeFiberDemo(dir: string): void {
    write(path.join(dir, 'demos', 'fiber.html'), demoPage('React Three Fiber', 'fiber.jsx'));
    write(
        path.join(dir, 'demos', 'fiber.jsx'),
        `
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'

// A 3D box written as a React component. Click it to change its color.
function Box(props) {
  const mesh = useRef()
  const [active, setActive] = useState(false)
  useFrame((_, delta) => {
    mesh.current.rotation.x += delta
    mesh.current.rotation.y += delta * 0.6
  })
  return (
    <mesh {...props} ref={mesh} onClick={() => setActive(!active)}>
      <boxGeometry args={[1.5, 1.5, 1.5]} />
      <meshStandardMaterial color={active ? '#e879f9' : '#2dd4bf'} />
    </mesh>
  )
}

const container = document.createElement('div')
container.style.height = '100%'
document.body.appendChild(container)

createRoot(container).render(
  <Canvas camera={{ position: [0, 0, 5] }}>
    <ambientLight intensity={0.6} />
    <directionalLight position={[3, 3, 5]} intensity={2} />
    <Box position={[-1.2, 0, 0]} />
    <Box position={[1.2, 0, 0]} />
    <OrbitControls />
  </Canvas>,
)
`,
    );
}

/** Nombres bonitos de cada demo para el índice. */
const demoTitles: Record<string, string> = {
    three: 'Three.js · 3D shape you can tilt with the mouse',
    fiber: 'React Three Fiber · 3D boxes as React components',
    gsap: 'GSAP · animated boxes on a timeline',
    p5: 'p5.js · colorful trail (move your mouse!)',
    phaser: 'Phaser · mini game with bouncing balls',
    leaflet: 'Leaflet · interactive map',
};

/**
 * Escribe demos/index.html con un enlace a cada demo que exista.
 * @param dir carpeta del proyecto
 */
export function writeDemoIndex(dir: string): void {
    const folder = path.join(dir, 'demos');
    if (!fs.existsSync(folder)) {
        return;
    }
    const links: string[] = [];
    for (const file of fs.readdirSync(folder).sort()) {
        const name = file.replace(/\.html$/, '');
        if (file.endsWith('.html') && name !== 'index') {
            links.push(`      <li><a href="./${file}">${demoTitles[name] ?? name}</a></li>`);
        }
    }
    write(
        path.join(folder, 'index.html'),
        `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Demos · DevStarter</title>
    <style>
      body { margin: 0; min-height: 100vh; background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; display: grid; place-items: center; }
      h1 { background: linear-gradient(90deg, #2dd4bf, #818cf8, #e879f9); -webkit-background-clip: text; color: transparent; }
      a { color: #a5b4fc; font-size: 18px; line-height: 2; }
    </style>
  </head>
  <body>
    <main>
      <h1>Library demos</h1>
      <p>Open each one, then look at its code in the <code>demos</code> folder.</p>
      <ul>
${links.join('\n')}
      </ul>
    </main>
  </body>
</html>
`,
    );
}
