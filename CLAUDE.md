# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules to follow
1. First think through the problem, read the codebase for relevant files, and write a plan to tasks/todo.md.
2. The plan should have a list of todo items that you can check off as you complete them
3. Before you begin working, check in with me and I will verify the plan.
4. Then, begin working on the todo items, marking them as complete as you go.
5. Please every step of the way just give me a high level explanation of what changes you made
6. Make every task and code change you do as simple as possible. We want to avoid making any massive or complex changes. Every change should impact as little code as possible. Everything is about simplicity.

## Overview

This is a **Web-to-React** conversion tool that transforms any website URL into a fully functional React project. The tool extracts HTML, CSS, images, and fonts from websites and converts them into modular React components with organized file structures.

## Key Commands

### Main conversion command
```bash
node html-to-react.js <URL> [component-name] [options]
```

### Available options
- `--create-app` or `-c`: Create a complete React app
- `--app-name` or `-a <name>`: Specify React app name
- `--include-computed` or `-i`: Include computed styles


## Core Architecture

### Main Entry Point
- `html-to-react.js` - Main orchestrator that handles route discovery and multi-page conversion

### Core Processing Pipeline
1. **Route Discovery** (`src/extractors/findRoutesWithPuppeteer.js`) - Discovers internal links from a starting URL
2. **Route Processing** (`src/processors/processRoute.js`) - Processes each individual route:
   - Extracts HTML using Puppeteer
   - Extracts styles (inline, computed, and external CSS)
   - Downloads and organizes fonts and images
   - Converts HTML to JSX
   - Creates component-specific directory structure

### Key Modules

#### Extractors (`src/extractors/`)
- `extractHTMLWithPuppeteer.js` - Extracts fully-rendered HTML including JS-generated content
- `extractStylesWithPuppeteer.js` - Extracts all CSS styles (inline, computed, external)
- `extractImages.js` - Downloads and organizes images with sanitized filenames
- `extractFonts.js` - Downloads fonts and generates font-face CSS
- `findRoutesWithPuppeteer.js` - Discovers internal navigation routes

#### Converters (`src/converters/`)
- `convertHTMLtoJSX.js` - Converts HTML to JSX with proper React attributes and image imports

#### Processors (`src/processors/`)
- `processRoute.js` - Orchestrates the entire conversion process for a single route

## Directory Structure

### Output Organization
The tool creates a modular structure where each page gets its own directory:

```
output/
├── html/                          # Raw HTML files
├── src/
│   └── pages/
│       ├── ComponentName/
│       │   ├── ComponentName.css    # Component-specific styles
│       │   ├── App.css             # Inline styles
│       │   ├── font-faces.css      # Font definitions
│       │   ├── custom-vars.css     # CSS custom properties
│       │   ├── images-flat/        # All images for this component
│       │   └── fonts-flat/         # All fonts for this component
│       └── ComponentName.jsx       # React component
├── routes.json                    # Discovered routes configuration
└── package.json                   # Generated React project config
```

### Key Features

#### Asset Management
- **Images**: Automatically downloaded, sanitized filenames, converted to ES6 imports
- **Fonts**: Downloaded and organized with proper font-face CSS generation
- **CSS**: Processed to fix asset paths and handle CSS custom properties

#### Component Generation
- Converts HTML to JSX with proper React attributes
- Handles SVG elements and namespaced attributes
- Creates modular components with route-specific styling
- Generates proper import statements for images and styles

#### Multi-Page Support
- Discovers internal links automatically
- Creates React Router-based navigation
- Maintains component isolation with page-specific asset directories

## Development Guidelines

### Adding New Extractors
- Follow the pattern in `src/extractors/` 
- Use Puppeteer for browser automation
- Handle errors gracefully and provide meaningful console output
- Test with various website structures

### Modifying Conversion Logic
- The HTML-to-JSX conversion is in `src/converters/convertHTMLtoJSX.js`
- Attribute mappings are maintained in `attributeRenameMap`
- Image path handling is done through `fixHtmlImagePath()`

### Asset Path Handling
- All asset paths are converted to use flat directory structure
- CSS paths are fixed using `fixAssetPaths()` functions
- Images are converted to ES6 imports for proper bundling

## Important Notes

### CSS Processing
- Inline styles are extracted to `App.css`
- Computed styles are saved to `computed.css` (can be disabled)
- External stylesheets are downloaded and organized
- CSS custom properties are converted to separate classes

### Image Processing
- All images are downloaded and renamed with sanitized filenames
- Original URLs are mapped to sanitized names for proper conversion
- Images are converted to ES6 imports in React components

### Font Processing
- Fonts are downloaded from CSS @font-face rules
- Font paths are normalized to use the flat fonts directory
- Font-face CSS is generated with correct paths

## Testing

Test the tool with different website types:
- Static sites
- Single-page applications
- Sites with complex CSS frameworks
- Sites with custom fonts and images

## Troubleshooting

### Common Issues
- **Puppeteer timeouts**: Increase timeout in browser launch options
- **Missing assets**: Check console output for failed downloads
- **Malformed JSX**: Review HTML structure for React-incompatible elements
- **CSS path issues**: Verify asset path fixing in CSS files

### Debug Commands
Use the individual extractor scripts for debugging:
```bash
node src/extractors/extractStylesWithPuppeteer.js <url>
node src/extractors/extractImages.js <url>
```