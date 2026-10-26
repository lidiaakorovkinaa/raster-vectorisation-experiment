import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { ROOT } from '../server/config.js';

const OUT = path.join(ROOT, 'public', 'samples');
mkdirSync(OUT, { recursive: true });
await initWasm(readFileSync(path.join(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')));
const inter = readFileSync(path.join(ROOT, 'assets/fonts/Inter.ttf'));
const newsreader = readFileSync(path.join(ROOT, 'assets/fonts/Newsreader.ttf'));

const samples = [
  {
    id: 'poster',
    name: 'Геометрический постер',
    description: 'Крупная типографика, градиенты и чистые цветовые поля. Проверка слоёв и точного цвета.',
    hint: 'Цветные движки; Potrace покажет силуэт.',
    tags: ['типографика', 'цвет', 'градиент'],
  },
  {
    id: 'lineart',
    name: 'Архитектурная графика',
    description: 'Тонкие штрихи, арки и перекрёстная штриховка. Проверка кривых и бинарной трассировки.',
    hint: 'Potrace; высокие требования к гладкости.',
    tags: ['линия', 'штриховка', 'бинарь'],
  },
  {
    id: 'badge',
    name: 'Тестовая эмблема',
    description: 'Кольца, звезда и монограмма на тёмном фоне. Проверка мелких деталей и слоёв.',
    hint: 'Все движки; важен IoU силуэта.',
    tags: ['логотип', 'мелкие детали', 'контраст'],
  },
  {
    id: 'landscape',
    name: 'Горный пейзаж',
    description: 'Плавные градиенты, атмосферная перспектива и мягкие цветовые переходы.',
    hint: 'VTracer и ImageTracer; цветовая точность.',
    tags: ['фото', 'градиент', 'пейзаж'],
  },
  {
    id: 'chart',
    name: 'Научный график',
    description: 'Оси, сетка, несколько серий и подписи. Проверка тонких линий и текста.',
    hint: 'Все движки, особенно векторная типографика.',
    tags: ['график', 'текст', 'тонкие линии'],
  },
];

const svgs = {
  poster: `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1250" viewBox="0 0 1000 1250">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6EEDC"/><stop offset="1" stop-color="#E9D9BE"/></linearGradient>
    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B6CB0"/><stop offset="1" stop-color="#183F66"/></linearGradient>
    <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#1E1E1E" opacity=".18"/></pattern>
  </defs>
  <rect width="1000" height="1250" fill="url(#g1)"/>
  <rect x="60" y="60" width="880" height="1130" fill="url(#dots)" opacity=".55"/>
  <circle cx="748" cy="300" r="238" fill="#C7492B"/>
  <circle cx="748" cy="300" r="238" fill="none" stroke="#F6EEDC" stroke-width="3" opacity=".45"/>
  <rect x="70" y="655" width="410" height="280" fill="url(#g2)"/>
  <path d="M70 655 L480 935 M70 935 L480 655" stroke="#F6EEDC" stroke-width="2" opacity=".35"/>
  <path d="M540 690 H920 M540 760 H920 M540 830 H920" stroke="#1E1E1E" stroke-width="2" opacity=".65"/>
  <text x="72" y="196" font-family="Newsreader" font-size="176" fill="#17191C" letter-spacing="-6">FORM</text>
  <text x="80" y="610" font-family="Inter" font-size="270" font-weight="700" fill="#17191C">02</text>
  <text x="548" y="1040" font-family="Newsreader" font-size="92" fill="#17191C">raster /</text>
  <text x="548" y="1135" font-family="Newsreader" font-size="92" font-style="italic" fill="#C7492B">vector</text>
  <text x="78" y="1044" font-family="Inter" font-size="24" letter-spacing="5" fill="#3A3C37">COMPARATIVE STUDY · 2026</text>
  <text x="78" y="1082" font-family="Inter" font-size="17" letter-spacing="2" fill="#6B6E66">POTRACE / IMAGETRACER / VTRACER</text>
  <g stroke="#1E1E1E" stroke-width="1" opacity=".3">
    <path d="M70 500 H480 M70 540 H480 M70 580 H480"/>
  </g>
</svg>`,
  lineart: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="#FAF7EF"/>
  <g fill="none" stroke="#141414" stroke-linecap="round">
    <path d="M90 810 V470 C90 300 220 170 390 170 C560 170 690 300 690 470 V810" stroke-width="7"/>
    <path d="M150 810 V485 C150 340 260 235 390 235 C520 235 630 340 630 485 V810" stroke-width="3"/>
    <path d="M210 810 V500 C210 380 290 300 390 300 C490 300 570 380 570 500 V810" stroke-width="1.6"/>
    <path d="M90 650 H690 M90 720 H690 M90 790 H690" stroke-width="1.2"/>
    <path d="M90 470 H690" stroke-width="9"/>
    <path d="M760 120 C860 220 910 340 900 490 C890 650 800 760 690 820" stroke-width="6"/>
    <path d="M810 145 C900 250 950 360 940 500 C930 630 860 730 760 790" stroke-width="2.2"/>
    <path d="M860 175 C940 270 985 370 975 505 C965 610 910 695 830 750" stroke-width="1"/>
    <g stroke-width="1.1">
      <path d="M760 250 L1010 250 M760 280 L1010 280 M760 310 L1010 310 M760 340 L1010 340 M760 370 L1010 370 M760 400 L1010 400 M760 430 L1010 430 M760 460 L1010 460 M760 490 L1010 490"/>
      <path d="M760 220 C800 300 800 440 760 540 M790 210 C830 300 830 450 790 560 M820 205 C860 300 860 470 820 590"/>
    </g>
    <circle cx="1030" cy="690" r="95" stroke-width="4"/>
    <circle cx="1030" cy="690" r="58" stroke-width="1.5"/>
    <path d="M1030 560 V820 M900 690 H1160 M940 600 L1120 780 M940 780 L1120 600" stroke-width="1"/>
    <g stroke-width="1.4">
      <path d="M740 820 C790 760 850 720 930 700 C1010 680 1100 675 1160 690"/>
      <path d="M740 840 C800 785 870 750 950 730 C1030 710 1110 710 1160 720"/>
    </g>
  </g>
  <text x="90" y="120" font-family="Inter" font-size="30" letter-spacing="8" fill="#141414">ARCHITECTURE / PLATE 07</text>
  <text x="90" y="160" font-family="Newsreader" font-size="40" fill="#141414">contour study</text>
  <text x="1040" y="860" font-family="Inter" font-size="16" fill="#666">1:50</text>
</svg>`,
  badge: `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <defs>
    <radialGradient id="bg" cx=".45" cy=".35" r=".8"><stop offset="0" stop-color="#1F6B52"/><stop offset="1" stop-color="#0B2D23"/></radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4D68C"/><stop offset=".5" stop-color="#C9A252"/><stop offset="1" stop-color="#8E6B24"/></linearGradient>
  </defs>
  <rect width="1000" height="1000" fill="url(#bg)"/>
  <g opacity=".18" stroke="#F4D68C" stroke-width="1"><path d="M0 200 H1000 M0 400 H1000 M0 600 H1000 M0 800 H1000 M200 0 V1000 M400 0 V1000 M600 0 V1000 M800 0 V1000"/></g>
  <circle cx="500" cy="500" r="365" fill="none" stroke="url(#gold)" stroke-width="18"/>
  <circle cx="500" cy="500" r="330" fill="none" stroke="#F4D68C" stroke-width="3"/>
  <circle cx="500" cy="500" r="292" fill="#F5F0E3"/>
  <circle cx="500" cy="500" r="250" fill="none" stroke="#0E3B2E" stroke-width="2"/>
  <g fill="#0E3B2E">
    <path d="M500 215 L530 330 L650 330 L554 400 L590 515 L500 448 L410 515 L446 400 L350 330 L470 330 Z"/>
    <circle cx="500" cy="500" r="118" fill="none" stroke="#0E3B2E" stroke-width="6"/>
  </g>
  <text x="500" y="560" text-anchor="middle" font-family="Newsreader" font-size="150" font-weight="700" fill="#0E3B2E">01</text>
  <text x="500" y="640" text-anchor="middle" font-family="Inter" font-size="24" letter-spacing="12" fill="#0E3B2E">TEST IMAGE</text>
  <g fill="#C9A252">
    <circle cx="182" cy="500" r="9"/><circle cx="818" cy="500" r="9"/><circle cx="500" cy="182" r="9"/><circle cx="500" cy="818" r="9"/>
    <path d="M300 730 L320 690 L340 730 L380 735 L350 762 L358 802 L320 780 L282 802 L290 762 L260 735 Z"/>
    <path d="M700 730 L720 690 L740 730 L780 735 L750 762 L758 802 L720 780 L682 802 L690 762 L660 735 Z"/>
  </g>
  <text x="500" y="880" text-anchor="middle" font-family="Inter" font-size="18" letter-spacing="6" fill="#C9A252">RASTER → VECTOR · 2026</text>
</svg>`,
  landscape: `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#163A5F"/><stop offset=".45" stop-color="#5B7FA6"/><stop offset=".72" stop-color="#E7A56C"/><stop offset="1" stop-color="#F6D6A6"/></linearGradient>
    <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF3C4"/><stop offset=".35" stop-color="#FFD27A" stop-opacity=".9"/><stop offset="1" stop-color="#FFB56B" stop-opacity="0"/></radialGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A9BA6"/><stop offset=".25" stop-color="#3E5C6B"/><stop offset="1" stop-color="#142C38"/></linearGradient>
    <linearGradient id="mtn1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6C7F8C"/><stop offset="1" stop-color="#405562"/></linearGradient>
    <linearGradient id="mtn2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3F5663"/><stop offset="1" stop-color="#243944"/></linearGradient>
  </defs>
  <rect width="1280" height="800" fill="url(#sky)"/>
  <circle cx="900" cy="430" r="220" fill="url(#sun)"/>
  <circle cx="900" cy="430" r="62" fill="#FFE9AE"/>
  <path d="M0 520 L170 360 L270 450 L390 300 L520 470 L650 390 L780 520 Z" fill="url(#mtn1)" opacity=".85"/>
  <path d="M0 560 L210 400 L330 520 L450 380 L600 540 L760 430 L920 560 Z" fill="url(#mtn2)"/>
  <path d="M760 560 L910 430 L1030 520 L1140 460 L1280 560 Z" fill="#1D323C"/>
  <rect y="555" width="1280" height="245" fill="url(#water)"/>
  <g opacity=".28" stroke="#F5C786" stroke-width="2">
    <path d="M760 590 H1040 M720 615 H1080 M780 640 H1020 M700 668 H1090 M760 700 H1030 M730 738 H1060"/>
  </g>
  <g opacity=".5" stroke="#B7C6C9" stroke-width="1">
    <path d="M80 600 H360 M40 630 H400 M110 660 H330 M60 698 H390 M130 730 H350 M90 770 H370"/>
  </g>
  <g fill="#0C1F17">
    <path d="M120 560 L155 470 L190 560 Z"/><path d="M190 560 L225 450 L260 560 Z"/><path d="M260 560 L290 490 L320 560 Z"/>
    <path d="M1040 560 L1080 455 L1120 560 Z"/><path d="M1110 560 L1150 480 L1190 560 Z"/>
  </g>
  <text x="65" y="105" font-family="Inter" font-size="18" letter-spacing="7" fill="#F4E6D3">FIELD NOTE / 47° 12′ N</text>
  <text x="65" y="162" font-family="Newsreader" font-size="54" fill="#F8EFE2">The quiet range</text>
  <text x="65" y="198" font-family="Inter" font-size="15" letter-spacing="2" fill="#D9CBB9">LIGHT STUDY · LATE AFTERNOON</text>
</svg>`,
  chart: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="#FBF9F3"/>
  <text x="80" y="105" font-family="Newsreader" font-size="46" fill="#17191C">Vectorization benchmark</text>
  <text x="82" y="140" font-family="Inter" font-size="16" letter-spacing="3" fill="#6B6E66">QUALITY VS. TIME · SYNTHETIC SERIES</text>
  <g stroke="#D8D3C6" stroke-width="1">
    <path d="M110 240 H1120 M110 360 H1120 M110 480 H1120 M110 600 H1120 M110 720 H1120"/>
    <path d="M110 240 V760 M310 240 V760 M510 240 V760 M710 240 V760 M910 240 V760 M1110 240 V760"/>
  </g>
  <g font-family="Inter" font-size="14" fill="#777A72">
    <text x="90" y="246">1.00</text><text x="90" y="366">0.75</text><text x="90" y="486">0.50</text><text x="90" y="606">0.25</text><text x="90" y="726">0.00</text>
    <text x="110" y="790">0</text><text x="296" y="790">50</text><text x="496" y="790">100</text><text x="696" y="790">150</text><text x="896" y="790">200</text><text x="1092" y="790">250</text>
    <text x="560" y="835" letter-spacing="2">TIME (MS)</text>
    <text x="46" y="500" transform="rotate(-90 46 500)" letter-spacing="2">SSIM</text>
  </g>
  <polyline fill="none" stroke="#C7492B" stroke-width="5" stroke-linejoin="round" points="150,640 260,600 390,560 520,520 690,470 880,430 1080,390"/>
  <polyline fill="none" stroke="#2B6CB0" stroke-width="5" stroke-linejoin="round" points="150,690 250,650 370,610 520,575 680,535 850,500 1060,455"/>
  <polyline fill="none" stroke="#1F7A5C" stroke-width="5" stroke-linejoin="round" points="150,700 280,660 420,610 570,555 730,500 900,450 1090,405"/>
  <g fill="#C7492B"><circle cx="150" cy="640" r="8"/><circle cx="390" cy="560" r="8"/><circle cx="690" cy="470" r="8"/><circle cx="1080" cy="390" r="8"/></g>
  <g fill="#2B6CB0"><circle cx="150" cy="690" r="8"/><circle cx="370" cy="610" r="8"/><circle cx="680" cy="535" r="8"/><circle cx="1060" cy="455" r="8"/></g>
  <g fill="#1F7A5C"><circle cx="150" cy="700" r="8"/><circle cx="420" cy="610" r="8"/><circle cx="730" cy="500" r="8"/><circle cx="1090" cy="405" r="8"/></g>
  <g font-family="Inter" font-size="17" fill="#17191C">
    <rect x="760" y="190" width="26" height="4" fill="#C7492B"/><text x="800" y="197">Potrace</text>
    <rect x="900" y="190" width="26" height="4" fill="#2B6CB0"/><text x="940" y="197">ImageTracer</text>
    <rect x="760" y="220" width="26" height="4" fill="#1F7A5C"/><text x="800" y="227">VTracer</text>
    <text x="940" y="227" fill="#777A72">n = 12</text>
  </g>
  <g transform="translate(110 835)">
    <rect x="0" y="0" width="180" height="8" fill="#C7492B"/><rect x="190" y="0" width="260" height="8" fill="#2B6CB0"/><rect x="460" y="0" width="350" height="8" fill="#1F7A5C"/>
  </g>
  <text x="1010" y="850" font-family="Inter" font-size="14" fill="#777A72">FIG. 03 / COMPARISON</text>
</svg>`,
};

for (const sample of samples) {
  const svg = svgs[sample.id];
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: false, fontBuffers: [inter, newsreader], defaultFontFamily: 'Inter' },
  });
  const png = Buffer.from(resvg.render().asPng());
  const file = path.join(OUT, `${sample.id}.png`);
  writeFileSync(file, png);
  const info = resvg.render();
  console.log(sample.id, info.width, info.height, Math.round(png.length / 1024) + 'KB');
}
writeFileSync(path.join(OUT, 'samples.json'), JSON.stringify({ samples }, null, 2));
