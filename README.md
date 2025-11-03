# RandevuCore

Modern ve kapsamlı bir randevu yönetimi ve video konferans platformu. RandevuCore, kullanıcıların çevrim içi randevu planlaması, toplantı yönetimi ve gerçek zamanlı video konferans gerçekleştirebilmesi için tasarlanmış full-stack bir web uygulamasıdır.

🌐 **Canlı Demo:** [https://staj.salihkarakaya.com.tr/](https://staj.salihkarakaya.com.tr/)

---

## ✨ Özellikler

### 🔐 Kimlik Doğrulama ve Kullanıcı Yönetimi
- JWT tabanlı güvenli authentication sistemi
- Parola hashleme (PasswordHasher)
- Kullanıcı kayıt ve giriş işlemleri
- Profil görüntüleme ve güncelleme

### 📅 Randevu Yönetimi
- Randevu oluşturma, görüntüleme, güncelleme ve silme (CRUD)
- Akıllı randevu çakışma kontrolü (overlap detection)
- Randevu durumu takibi (scheduled, canceled, done)
- Kullanıcı bazlı randevu listeleme (creator/invitee)

### 🔔 Gerçek Zamanlı Bildirimler
- SignalR ile realtime event bildirimleri
- Anlık randevu ve toplantı güncellemeleri
- 1 saniyenin altında event teslim süresi

### 🎥 Video Konferans
- WebRTC tabanlı 1:1 ve çoklu katılımcı video konferans
- Oda bazlı toplantı sistemi
- Kamera ve mikrofon kontrolü (açma/kapama)
- Ekran paylaşımı desteği
- Video grid layout ile katılımcı görünümü

### 🎨 Beyaz Tahta (Whiteboard)
- Eşzamanlı çizim desteği
- Yetkilendirme tabanlı kullanım (toplantı sahibi kontrolü)
- SignalR ile gerçek zamanlı senkronizasyon
- Canvas tabanlı interaktif çizim arayüzü

---

## 🛠️ Teknoloji Stack'i

### Backend
- **.NET 8.0** - Web API framework
- **Entity Framework Core 9.0** - ORM
- **SQL Server (MSSQL)** - Veritabanı
- **SignalR** - Realtime communication
- **JWT Bearer Authentication** - Güvenlik
- **Onion Architecture** - Clean architecture pattern

### Frontend
- **Angular 20.3** - Modern web framework
- **TypeScript 5.9** - Type-safe programming
- **Tailwind CSS 4.1** - Utility-first CSS framework
- **RxJS** - Reactive programming
- **SignalR Client** - Realtime client connection
- **WebRTC** - Peer-to-peer video communication

### Mimari
- **Onion Architecture** (Domain, Application, Infrastructure, API katmanları)
- **Repository Pattern** - Veri erişim soyutlaması
- **Dependency Injection** - Loose coupling
- **DTO Pattern** - Veri transfer nesneleri

---

## 📁 Proje Yapısı

```
RandevuCore/
├── backend/
│   ├── API/                  # Web API katmanı (Controllers, SignalR Hub)
│   ├── Application/          # İş mantığı katmanı (Services, DTOs)
│   ├── Domain/               # Domain katmanı (Entities, Interfaces)
│   └── Infrastructure/       # Altyapı katmanı (DbContext, Repositories, Migrations)
├── frontend/                 # Angular uygulaması
│   ├── src/
│   │   └── app/
│   │       ├── features/    # Feature modülleri
│   │       ├── core/         # Core servisler ve guards
│   │       └── shared/       # Paylaşılan bileşenler
└── README.md
```

---

## 🚀 Kurulum

### Ön Gereksinimler

- **.NET 8.0 SDK** veya üzeri
- **Node.js 18+** ve **npm**
- **SQL Server** (LocalDB, Express veya Full Edition)
- **Angular CLI** (global): `npm install -g @angular/cli`

### Backend Kurulumu

1. **Repository'yi klonlayın:**
   ```bash
   git clone <repository-url>
   cd RandevuCore/backend
   ```

2. **Veritabanı bağlantı string'ini ayarlayın:**
   
   `API/appsettings.json` dosyasında connection string'i güncelleyin:
   ```json
   {
     "ConnectionStrings": {
       "DefaultConnection": "Server=(localdb)\\mssqllocaldb;Database=RandevuCoreDb;Trusted_Connection=True;"
     }
   }
   ```

3. **JWT ayarlarını yapılandırın:**
   ```json
   {
     "JwtSettings": {
       "Secret": "your-secret-key-here-min-32-characters",
       "Issuer": "RandevuCore",
       "Audience": "RandevuCoreUsers"
     }
   }
   ```

4. **Migrations'ı uygulayın:**
   ```bash
   cd Infrastructure
   dotnet ef database update --project ../Infrastructure --startup-project ../API
   ```

5. **Backend'i çalıştırın:**
   ```bash
   cd API
   dotnet run
   ```
   
   Backend API varsayılan olarak `http://localhost:5000` adresinde çalışacaktır.

### Frontend Kurulumu

1. **Dependencies'leri yükleyin:**
   ```bash
   cd frontend
   npm install
   ```

2. **API endpoint'ini yapılandırın:**
   
   `src/assets/config.json` dosyasında API URL'ini güncelleyin:
   ```json
   {
     "apiUrl": "http://localhost:5000"
   }
   ```

3. **Frontend'i çalıştırın:**
   ```bash
   npm start
   ```
   
   Angular uygulaması `http://localhost:4200` adresinde çalışacaktır.

---

## 📖 Kullanım

### Kayıt ve Giriş

1. Ana sayfada **Kayıt Ol** butonuna tıklayın
2. Email, isim ve parola bilgilerinizi girin
3. Kayıt işleminden sonra **Giriş Yap** sayfasına yönlendirilirsiniz
4. JWT token otomatik olarak localStorage'da saklanır

### Randevu Oluşturma

1. **Randevular** sayfasına gidin
2. **Yeni Randevu** butonuna tıklayın
3. Randevu bilgilerini doldurun:
   - Başlık
   - Başlangıç ve bitiş tarihi/saati
   - Katılımcı (invitee) seçimi
   - Notlar (opsiyonel)
4. Sistem otomatik olarak çakışma kontrolü yapar
5. Çakışma yoksa randevu oluşturulur ve katılımcıya bildirim gönderilir

### Video Toplantı

1. Randevu detay sayfasından **Toplantıya Katıl** butonuna tıklayın
2. Kamera ve mikrofon izinlerini verin
3. Toplantı odasına bağlanın
4. **Kamera/Mikrofon** kontrol butonları ile medya cihazlarınızı yönetin
5. **Ekran Paylaşımı** ile ekranınızı paylaşın
6. Toplantı sahibi olarak **Beyaz Tahta** başlatabilir ve katılımcılara yetki verebilirsiniz

### Beyaz Tahta Kullanımı

1. Toplantı sahibi olarak **Beyaz Tahta** butonuna tıklayın
2. Beyaz tahta açılır ve tüm katılımcılar görebilir
3. Çizim yapmak için kullanıcılara **Çizim Yetkisi** verin
4. Yetkili kullanıcılar eşzamanlı olarak çizim yapabilir
5. Çizimler tüm katılımcılara gerçek zamanlı olarak senkronize edilir

---

## 🔧 API Dokümantasyonu

Backend API Swagger ile dokümante edilmiştir. Uygulama çalışırken aşağıdaki adresten erişebilirsiniz:

```
http://localhost:5000/swagger
```

### Ana Endpoint'ler

- **POST** `/api/auth/register` - Kullanıcı kaydı
- **POST** `/api/auth/login` - Kullanıcı girişi
- **GET** `/api/users/profile` - Kullanıcı profili
- **PUT** `/api/users/profile` - Profil güncelleme

- **GET** `/api/appointments` - Randevu listesi
- **POST** `/api/appointments` - Yeni randevu
- **GET** `/api/appointments/{id}` - Randevu detayı
- **PUT** `/api/appointments/{id}` - Randevu güncelleme
- **DELETE** `/api/appointments/{id}` - Randevu silme

- **GET** `/api/meetings` - Toplantı listesi
- **POST** `/api/meetings` - Yeni toplantı
- **GET** `/api/meetings/{id}` - Toplantı detayı

- **WS** `/ws` - SignalR Hub (realtime events)

---

## 🗄️ Veri Modeli

### User
- `Id` (GUID, Primary Key)
- `Email` (NVARCHAR, UNIQUE)
- `PasswordHash` (NVARCHAR)
- `Name` (NVARCHAR)
- `CreatedAt`, `UpdatedAt` (DATETIMEOFFSET)

### Appointment
- `Id` (GUID, Primary Key)
- `Title` (NVARCHAR)
- `StartsAt`, `EndsAt` (DATETIMEOFFSET)
- `Status` (ENUM: scheduled | canceled | done)
- `Notes` (NVARCHAR(MAX))
- `CreatorId` (FK → User.Id)
- `InviteeId` (FK → User.Id)
- `CreatedAt`, `UpdatedAt`

**İndeksler:** `(CreatorId, StartsAt)`, `(InviteeId, StartsAt)`

### Meeting
- `Id` (GUID, Primary Key)
- `Title` (NVARCHAR)
- `StartsAt`, `EndsAt` (DATETIMEOFFSET)
- `Status` (ENUM: scheduled | canceled | done)
- `Notes` (NVARCHAR(MAX))
- `CreatorId` (FK → User.Id)
- `VideoSessionId` (string)
- `WhiteboardSessionId` (string)
- `CreatedAt`, `UpdatedAt`
- `Invitees` (Many-to-Many → User)

### WhiteboardPermission
- `Id` (GUID, Primary Key)
- `MeetingId` (FK → Meeting.Id)
- `UserId` (FK → User.Id)
- `CanDraw` (bool)

---

## 🔒 Güvenlik

- **JWT Authentication:** Tüm API endpoint'leri JWT token ile korunur
- **Password Hashing:** ASP.NET Core Identity PasswordHasher kullanılır
- **CORS Policy:** Sadece frontend domain'i izin verilir
- **Input Validation:** Backend ve frontend'de çift katmanlı validasyon
- **Authorization:** Sadece randevu/toplantı sahibi güncelleme yapabilir

---

## 📊 Performans Metrikleri

- ✅ Login işlemleri: %95+ başarı oranı
- ✅ CRUD işlemleri: p95 gecikme < 150ms
- ✅ Event teslimi: < 1 saniye
- ✅ Çakışma kontrolü: %100 doğruluk
- ✅ Video konferans: %80+ başarı oranı

---

## 🤝 Katkıda Bulunma

1. Bu repository'yi fork edin
2. Feature branch oluşturun (`git checkout -b feature/amazing-feature`)
3. Değişikliklerinizi commit edin (`git commit -m 'Add some amazing feature'`)
4. Branch'inizi push edin (`git push origin feature/amazing-feature`)
5. Pull Request oluşturun

---

## 📝 Lisans

Bu proje açık kaynak kodludur. Detaylar için `LICENSE` dosyasına bakın.

---

## 👤 Geliştirici

**Salih Karakaya**

- 🌐 Website: [https://staj.salihkarakaya.com.tr/](https://staj.salihkarakaya.com.tr/)
- 📧 Email: [İletişim için website üzerinden ulaşabilirsiniz]

---

## 🙏 Teşekkürler

Bu proje geliştirilirken kullanılan açık kaynak kütüphanelere ve topluluğa teşekkür ederiz.

---

**⭐ Beğendiyseniz yıldız vermeyi unutmayın!**
