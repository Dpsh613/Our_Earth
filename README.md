# The Earth Remembers

An interactive 3D living landscape. Between what was broken and what waits to return — explore a scarred world and restore it by touching the damaged ground.

Built with **Three.js**, **TypeScript**, and **Vite**.

## Features

- Procedural 3D terrain, vegetation, water, and wildlife
- Interactive restoration: click damaged ground to heal it
- Cinematic post-processing (bloom, filmic tone mapping, soft shadows)
- Aerial and ground exploration modes
- Generative ambient soundscape
- Guided viewpoints and a minimal HUD

## Controls

| Input | Action |
| --- | --- |
| Click damaged ground | Restore it |
| Drag / WASD | Explore |
| Scroll | Zoom |
| `G` | Toggle aerial / ground mode |
| `R` | Reset restoration |
| `M` | Toggle ambient sound |
| `H` | Hide UI |

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

The output is generated in `dist/`.

## Deployment

This project is configured for [Vercel](https://vercel.com): the `vercel.json` file
declares the Vite framework preset, the build command, and the `dist` output directory.
Import the repository into Vercel (or run `vercel`) and it will build and deploy automatically.
