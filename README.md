# PDF Viewer - Solstice

A modern, sleek PDF viewer built with Next.js, React, and TypeScript. Features drag-and-drop file upload, thumbnail navigation, zoom, and pan capabilities.

## Features

- 📄 **Drag & Drop**: Simply drag a PDF file onto the page to view it
- 🖼️ **Thumbnail Navigation**: Browse through pages using the sidebar thumbnails
- 🔍 **Zoom Controls**: Zoom in/out with buttons or Ctrl/Cmd + Scroll
- 🖱️ **Pan & Drag**: Click and drag to pan around the PDF when zoomed in
- 🎨 **Modern UI**: Beautiful, responsive design with dark mode support
- ⚡ **Fast & Lightweight**: Built with Next.js 15 and optimized for performance

## Getting Started

### Prerequisites

- Node.js 20.9 or later
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

### Usage

1. **Upload a PDF**: 
   - Drag and drop a PDF file onto the page, or
   - Click "Choose a PDF file" to browse your files

2. **Navigate Pages**:
   - Use the thumbnail sidebar to jump to any page
   - Use the Previous/Next buttons in the toolbar
   - Click on any thumbnail to navigate directly

3. **Zoom**:
   - Click the `+` and `−` buttons to zoom in/out
   - Use `Ctrl` (Windows/Linux) or `Cmd` (Mac) + Scroll wheel
   - Click "Reset" to return to 100% zoom and center position

4. **Pan**:
   - Click and drag the PDF to move it around when zoomed in
   - The cursor changes to indicate when you can drag

## Tech Stack

- **Next.js 15** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **react-pdf** - PDF rendering
- **pdfjs-dist** - PDF.js library

## Project Structure

```
Solstice/
├── app/
│   ├── layout.tsx      # Root layout
│   ├── page.tsx        # Main PDF viewer page
│   └── globals.css     # Global styles
├── package.json
├── tsconfig.json
└── tailwind.config.ts
```

## Build for Production

```bash
npm run build
npm start
```

## License

MIT

