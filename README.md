# Web-to-React

A powerful tool that transforms any website into a fully functional React project. Extract HTML, CSS, images, and fonts from websites and convert them into modular React components with organized file structures.

## Features

- 🌐 **Multi-page Support** - Automatically discovers internal links and converts entire websites
- 🎨 **Smart CSS Processing** - Two strategies: modular (component-based) and global (monolithic)
- 🖼️ **Asset Management** - Downloads and organizes images, fonts, and stylesheets
- ⚛️ **React Conversion** - Converts HTML to JSX with proper React attributes
- 🎯 **Tailwind Support** - Built-in support for Tailwind CSS projects
- 📱 **Modern Output** - Generates clean, deployable React applications

## Quick Start

```bash
# Convert a single page
node html-to-react.js https://example.com

# Convert entire website with app creation
node html-to-react.js https://example.com --create-app --app-name my-app

# Use global CSS strategy (ideal for Webflow sites)
node html-to-react.js https://webflow-site.com --strategy global --create-app
```

## Installation

```bash
git clone <repository-url>
cd Web-to-React
npm install
```

## Usage

### Basic Command

```bash
node html-to-react.js <URL> [component-name] [options]
```

### Options

| Option | Short | Description |
|--------|-------|-------------|
| `--create-app` | `-c` | Create a complete React app with routing |
| `--app-name <name>` | `-a` | Specify the React app name |
| `--include-computed` | `-i` | Include computed styles in output |
| `--strategy <type>` | `-s` | CSS processing strategy (`modular` or `global`) |

## CSS Processing Strategies

### Modular Strategy (Default)

**Best for:** Tailwind CSS, component-based sites, modern frameworks

- Each component has its own CSS files
- Component-specific asset directories
- Automatic Tailwind CSS support
- Perfect for component-scoped styling

```bash
node html-to-react.js https://tailwind-site.com --strategy modular
```

### Global Strategy

**Best for:** Webflow sites, traditional websites, monolithic CSS

- Single global CSS file for all components
- Consolidated and deduplicated styles
- Page-specific asset directories maintained
- Ideal for sites with large shared stylesheets

```bash
node html-to-react.js https://webflow-site.com --strategy global
```

## Output Structure

### Modular Strategy
```
output/
├── src/
│   └── pages/
│       ├── ComponentName/
│       │   ├── ComponentName.css     # Component styles
│       │   ├── App.css              # Inline styles
│       │   ├── font-faces.css       # Font definitions
│       │   ├── custom-vars.css      # CSS variables
│       │   ├── images-flat/         # Component images
│       │   └── fonts-flat/          # Component fonts
│       └── ComponentName.jsx        # React component
├── routes.json                      # Route configuration
└── package.json                     # React project config
```

### Global Strategy
```
output/
├── src/
│   ├── pages/
│   │   ├── ComponentName/
│   │   │   ├── images-flat/         # Page-specific images
│   │   │   └── fonts-flat/          # Page-specific fonts
│   │   └── ComponentName.jsx        # React component
│   └── shared/
│       └── global.css               # All styles consolidated
├── routes.json
└── package.json
```

## Examples

### Convert a Tailwind CSS Site
```bash
node html-to-react.js https://tailwindui.com/preview --strategy modular --create-app --app-name tailwind-app
```

### Convert a Webflow Site
```bash
node html-to-react.js https://webflow-template.webflow.io --strategy global --create-app --app-name webflow-app
```

### Convert with Computed Styles
```bash
node html-to-react.js https://example.com --include-computed --create-app
```

## Architecture

The tool follows a modular pipeline architecture:

1. **Route Discovery** - Finds all internal links using Puppeteer
2. **HTML Extraction** - Captures fully-rendered HTML including JS-generated content
3. **Asset Processing** - Downloads images, fonts, and stylesheets
4. **CSS Processing** - Applies chosen strategy (modular/global)
5. **JSX Conversion** - Transforms HTML to React components
6. **Project Generation** - Creates complete React application structure

## Key Components

- **`html-to-react.js`** - Main orchestrator
- **`src/extractors/`** - HTML, CSS, image, and font extraction
- **`src/converters/`** - HTML to JSX conversion
- **`src/processors/`** - Strategy-based processing logic

## Requirements

- Node.js 14+
- Puppeteer (for browser automation)
- Internet connection (for asset downloads)

## Troubleshooting

### Common Issues

**Puppeteer timeouts**
- Increase timeout in browser launch options
- Check internet connection stability

**Missing assets**
- Review console output for failed downloads
- Verify source website accessibility

**Malformed JSX**
- Check HTML structure for React-incompatible elements
- Review conversion logs for specific errors

**CSS path issues**
- Verify asset path fixing in generated CSS files
- Check image import statements in components

### Debug Mode

Use individual extractor scripts for debugging:

```bash
node src/extractors/extractStylesWithPuppeteer.js <url>
node src/extractors/extractImages.js <url>
node src/extractors/findRoutesWithPuppeteer.js <url>
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test with various website types
4. Submit a pull request

## License

[Add your license here]

## Support

For issues and feature requests, please create an issue in the repository.