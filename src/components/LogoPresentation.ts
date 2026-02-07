// Logo Presentation Component - Showcasing the App Identity
// Route: /logo

export function renderLogoPage() {
  const app = document.getElementById('app')!;
  app.innerHTML = '';
  document.body.style.background = '#09090b'; // Ensure dark background
  document.body.style.display = 'flex';
  document.body.style.flexDirection = 'column';

  const container = document.createElement('div');
  container.className = 'logo-page-container';
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: 'Inter', sans-serif;
    color: white;
    gap: 40px;
  `;

  // Logo Definition
  // Concept: "Pulse" - Minimalist Audio Wave in a Circle/Square
  // We use pure HTML/CSS for the logo to ensure high quality and scalability

  container.innerHTML = `
    <div class="brand-section">
      <div class="logo-display large">
         <div class="pulse-logo">
            <div class="pulse-bar left"></div>
            <div class="pulse-bar center"></div>
            <div class="pulse-bar right"></div>
         </div>
      </div>
      <h1 style="font-size: 3rem; font-weight: 700; letter-spacing: -0.05em; margin-top: 24px;">Pulse.</h1>
    </div>

    <div class="brand-section light-mode" style="background: white; padding: 40px; border-radius: 20px;">
       <div class="logo-display">
         <div class="pulse-logo dark">
            <div class="pulse-bar left"></div>
            <div class="pulse-bar center"></div>
            <div class="pulse-bar right"></div>
         </div>
       </div>
       <h1 style="font-size: 2rem; font-weight: 700; letter-spacing: -0.05em; margin-top: 16px; color: black;">Pulse.</h1>
    </div>

    <!-- Download Controls -->
    <div style="display: flex; gap: 16px; margin-top: 20px;">
        <button id="dl-svg" class="btn btn-secondary" style="border: 1px solid #333; color: white; padding: 12px 24px;">Download SVG</button>
        <button id="dl-png" class="btn btn-secondary" style="border: 1px solid #333; color: white; padding: 12px 24px;">Download PNG</button>
    </div>

    <!-- Hidden Canvas for Rasterization -->
    <canvas id="logo-canvas" width="512" height="512" style="display: none;"></canvas>

    <!-- CSS for the logo locally scoped here for presentation -->
    <style>
      .pulse-logo {
        width: 80px;
        height: 80px;
        background: white;
        border-radius: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        box-shadow: 0 0 30px rgba(255,255,255,0.1);
      }
      /* ... rest of styles ... */
      .pulse-logo.dark {
        background: black;
        box-shadow: none;
      }

      .pulse-bar {
        width: 8px;
        background: black;
        border-radius: 4px;
      }

      .pulse-logo.dark .pulse-bar {
        background: white;
      }

      /* Logo Shape Definition */
      .pulse-bar.left { height: 24px; animation: pulse 2s infinite ease-in-out; }
      .pulse-bar.center { height: 40px; animation: pulse 2s infinite ease-in-out 0.2s; }
      .pulse-bar.right { height: 24px; animation: pulse 2s infinite ease-in-out 0.4s; }

      @keyframes pulse {
        0%, 100% { transform: scaleY(1); opacity: 1; }
        50% { transform: scaleY(0.7); opacity: 0.8; }
      }
    </style>
  `;

  app.appendChild(container);

  // SVG Markup (Static for Download)
  const svgContent = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="140" fill="white"/>
  <rect x="170" y="176" width="40" height="160" rx="20" fill="black"/>
  <rect x="236" y="128" width="40" height="256" rx="20" fill="black"/>
  <rect x="302" y="176" width="40" height="160" rx="20" fill="black"/>
</svg>`.trim();

  // SVG Download Handler
  document.getElementById('dl-svg')?.addEventListener('click', () => {
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pulse-logo.svg';
    a.click();
    URL.revokeObjectURL(url);
  });

  // PNG Download Handler
  document.getElementById('dl-png')?.addEventListener('click', () => {
    const canvas = document.getElementById('logo-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw to canvas
    const img = new Image();
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    img.onload = () => {
        ctx.clearRect(0, 0, 512, 512);
        ctx.drawImage(img, 0, 0);
        
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = 'pulse-logo.png';
        a.click();
        URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
