/**
 * templates/presets.ts
 * ────────────────────
 * "Empieza desde una idea": combinaciones listas para quien no sabe programar.
 * En vez de elegir "Vite + Three.js + GSAP", la persona elige "Una web en 3D"
 * y DevStarter decide la plantilla, las librerías y las opciones adecuadas.
 */
import { Database } from '../scaffold/database';

/** Una idea de proyecto con todo decidido. */
export interface Preset {
    id: string;
    label: string;
    /** Icono de VS Code (codicon). */
    icon: string;
    /** Qué se va a crear, en pocas palabras. */
    description: string;
    /** Para qué sirve, explicado sin tecnicismos. */
    detail: string;
    template: string;
    backend?: string;
    typescript: boolean;
    tailwind: boolean;
    database?: Database;
    libraries: string[];
}

export const presets: Preset[] = [
    {
        id: 'portfolio',
        label: 'My personal website or portfolio',
        icon: 'account',
        description: 'Astro + Tailwind',
        detail: 'Show who you are and what you do. Fast, simple and easy to publish for free.',
        template: 'astro',
        typescript: false,
        tailwind: true,
        libraries: ['aos'],
    },
    {
        id: 'landing',
        label: 'A landing page with animations',
        icon: 'megaphone',
        description: 'HTML/CSS/JS + Tailwind + GSAP',
        detail: 'A one-page website for a product, event or idea, with smooth animations.',
        template: 'vanilla',
        typescript: false,
        tailwind: true,
        libraries: ['gsap', 'aos', 'swiper'],
    },
    {
        id: '3d',
        label: 'A 3D website',
        icon: 'globe',
        description: 'HTML/CSS/JS + Three.js + GSAP',
        detail: 'Interactive 3D scenes in the browser. Comes with a 3D demo you can play with.',
        template: 'vanilla',
        typescript: false,
        tailwind: true,
        libraries: ['three', 'gsap'],
    },
    {
        id: 'game',
        label: 'A game for the browser',
        icon: 'game',
        description: 'HTML/CSS/JS + Phaser',
        detail: 'Make 2D games with physics. Comes with a mini game to start from.',
        template: 'vanilla',
        typescript: false,
        tailwind: false,
        libraries: ['phaser'],
    },
    {
        id: 'creative',
        label: 'Interactive art and drawings with code',
        icon: 'paintcan',
        description: 'HTML/CSS/JS + p5.js',
        detail: 'Draw shapes, colors and animations with code. The friendliest way to learn programming.',
        template: 'vanilla',
        typescript: false,
        tailwind: false,
        libraries: ['p5'],
    },
    {
        id: 'blog',
        label: 'A blog',
        icon: 'book',
        description: 'Astro + Tailwind + MDX',
        detail: 'Write posts in Markdown (like a text file) and publish them as a beautiful website.',
        template: 'astro',
        typescript: false,
        tailwind: true,
        libraries: ['astro-mdx'],
    },
    {
        id: 'webapp',
        label: 'A web app with users and data',
        icon: 'browser',
        description: 'Next.js + Tailwind + SQLite',
        detail: 'Apps like a to-do list, a booking system or a dashboard, with a database included.',
        template: 'next',
        typescript: true,
        tailwind: true,
        database: 'SQLite',
        libraries: ['react-hook-form', 'react-icons'],
    },
    {
        id: 'fullstack',
        label: 'A website with its own API',
        icon: 'layers',
        description: 'React + Express + SQLite',
        detail: 'A frontend and a backend already connected. The classic way to learn full-stack.',
        template: 'react',
        backend: 'express',
        typescript: true,
        tailwind: true,
        database: 'SQLite',
        libraries: ['react-router', 'helmet', 'morgan'],
    },
    {
        id: 'map',
        label: 'A website with an interactive map',
        icon: 'location',
        description: 'HTML/CSS/JS + Leaflet',
        detail: 'Show places on a map with markers and popups. Free map data from OpenStreetMap.',
        template: 'vanilla',
        typescript: false,
        tailwind: true,
        libraries: ['leaflet'],
    },
    {
        id: 'mobile',
        label: 'A mobile app',
        icon: 'device-mobile',
        description: 'React Native (Expo)',
        detail: 'An app for iPhone and Android. Try it on your own phone with the free Expo Go app.',
        template: 'expo',
        typescript: true,
        tailwind: false,
        libraries: ['zustand'],
    },
    {
        id: 'automation',
        label: 'Automate tasks with Python',
        icon: 'robot',
        description: 'Python script',
        detail: 'Rename files, download data from the web, process spreadsheets… Python is great at it.',
        template: 'python-script',
        typescript: false,
        tailwind: false,
        libraries: ['requests', 'rich', 'pandas'],
    },
];
