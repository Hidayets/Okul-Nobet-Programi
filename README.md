# Okul Nöbet Programı

Okullarda nöbet çizelgesi oluşturma, ders programı yönetimi ve devamsız öğretmenlerin derslerini adil dağıtma işlemlerini kolaylaştıran web tabanlı masaüstü uygulaması.

## Özellikler

- **Eğitim-Öğretim Dönemi** — Her yılın verileri birbirinden bağımsız, dönemler arası öğretmen listesi aktarma, header'dan hızlı dönem geçişi
- **Kurum Yönetimi** — Kurum kodu ile kayıt, admin/öğretmen giriş sistemi, lisans yönetimi
- **Öğretmen Yönetimi** — Ekleme, düzenleme, toplu silme, Excel/panodan aktarma, Sabit/Hareketli/Nöbet Dışı türleri
- **Ders Programı** — Excel'den yükleme veya hücre hücre elle girme, öğretmen ve sınıf programları karşılaştırma
- **Nöbet Çizelgesi Oluşturma** — Adil Dönerli, Dönerli, Merdiven ve Sabit Atama modları; yıl içi eşit dağıtım (toplam, nöbet yeri, ay ve ders yükü dengesi)
- **Günlük İşlemler** — Devamsız öğretmen girişi, boş kalan derslerin nöbetçiler arasında adil otomatik dağılımı
- **Çoklu Bilgisayar** — Ana bilgisayar + istemci modu; 30 sn'de bir otomatik veri senkronu
- **Ayarlar** — Okul bilgileri, ders saatleri, MEB tatil takvimi, tema, şifre, yedekleme/geri yükleme

## Teknolojiler

| Katman | Teknoloji |
|--------|-----------|
| Frontend | React 19, TypeScript, Tailwind CSS 4, Vite 6 |
| Backend | Express, Node.js, better-sqlite3 |
| Auth | JWT, bcrypt |
| Test | Vitest |
| Masaüstü | Electron (geliştirme), pkg + Inno Setup (dağıtım) |

## Kurulum ve Çalıştırma

### Gereksinimler

- Node.js 20+
- npm

### Ortam değişkenleri

Üretim kurulumunda `.env.example` dosyasını `.env` olarak kopyalayın ve **mutlaka** değiştirin:

- `JWT_SECRET` — Oturum imzalama anahtarı
- `LICENSE_SECRET` — Lisans anahtarı üretimi (generate-license.cjs ile aynı olmalı)

### Geliştirme

```bash
npm install
npm run dev
```

Tarayıcıda `http://localhost:3000` adresini açın.

### Test

```bash
npm test
```

### Electron ile Geliştirme

```bash
npm run electron:dev
```

### Masaüstü Kurulum Paketi Oluşturma

```bash
npm run build:desktop
```

Bu komut sırasıyla:
1. React frontend'i Vite ile derler
2. Express sunucuyu esbuild ile tek dosyaya paketler
3. `@yao-pkg/pkg` ile `OkulNobet.exe` oluşturur
4. Inno Setup kuruluysa `OkulNobetKurulum.exe` installer'ı üretir

Çıktılar `release/` klasöründe oluşur.

## Proje Yapısı

```
├── src/                  # React frontend
│   ├── components/       # Sayfa bileşenleri
│   ├── lib/              # Nöbet dağıtım algoritması, takvim vb.
│   ├── hooks/            # API senkron hook'ları
│   ├── types.ts          # TypeScript tip tanımları
│   └── main.tsx          # Uygulama giriş noktası
├── server.ts             # Express API sunucusu
├── electron/             # Electron ana süreç
├── installer/            # Inno Setup betikleri
├── scripts/              # Build pipeline
└── build/                # Uygulama ikonu
```

## Lisans
