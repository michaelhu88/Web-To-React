# Tailwind CSS Setup

This project uses Tailwind CSS for styling.

## Installation

To use Tailwind CSS in this project, install the required dependencies:

```
npm install tailwindcss postcss autoprefixer
```

## Usage

The Tailwind configuration files have been set up for you:

- `tailwind.config.js` - Main Tailwind configuration
- `postcss.config.js` - PostCSS configuration for Tailwind
- `styles/tailwind.css` - Main CSS file with Tailwind directives

Import the `tailwind.css` file in your main component or entry file:

```jsx
import './styles/tailwind.css';
```

## Dark Mode

Dark mode is configured to use the 'class' strategy. To enable dark mode:

```jsx
// Add the 'dark' class to your HTML or root element
document.documentElement.classList.add('dark');
```

## Learn More

- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Dark Mode in Tailwind CSS](https://tailwindcss.com/docs/dark-mode)
