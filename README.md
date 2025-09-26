# RandevuCore

RandevuCore – Teknik İsterler (Requirements) – .NET Core + Angular + MSSQL + Onion Architecture

## 1. Proje Amacı

RandevuCore, kullanıcıların çevrim içi randevu ve toplantı planlaması, yönetimi ve video konferans gerçekleştirebilmesi için tasarlanmış modern bir web uygulamasıdır.

### Hedefler

* Kullanıcıların kolay ve güvenli şekilde randevu oluşturup yönetmesini sağlamak.
* Backend tarafında **.NET Core + EF Core + MSSQL** ile ölçeklenebilir ve test edilebilir bir mimari sunmak.
* Frontend tarafında **Angular** ile hızlı, anlaşılır ve etkileşimli bir kullanıcı deneyimi sağlamak.
* JWT authentication, randevu çakışma kontrolü, realtime bildirimler ve opsiyonel WebRTC video görüşme ile modern web uygulama yetkinliklerini göstermek.
* Toplantı sırasında kamera/mikrofon kontrolü, ekran paylaşımı ve beyaz tahta (whiteboard) ile eşzamanlı işbirliği.

---

## 2. Kapsam

### Kapsam Dahil

* JWT tabanlı authentication ve parola hashleme
* Kullanıcı profili görüntüleme ve güncelleme
* Randevu CRUD işlemleri (Create, Read, Update, Delete)
* Randevu çakışma kontrolü (overlap)
* Realtime bildirimler (SignalR)
* WebRTC ile 1:1 veya çoklu katılımcı video konferans
* Toplantı içi kamera/mikrofon açma-kapama, ekran paylaşımı
* Beyaz tahta (whiteboard) özelliği; yetkili kullanıcılar eşzamanlı çizim yapabilir
* Angular frontend ile Login/Register, Randevu Listesi, Randevu Detay ve Toplantı ekranları

### Kapsam Dışında

* Şifre sıfırlama ve e-posta doğrulama
* Rol yönetimi veya admin paneli (yalnızca toplantı sahibi yetkilendirme)
* Prod dağıtımı, CI/CD veya performans ölçek testleri

---

## 3. Kullanıcı Hikâyeleri ve Kabul Kriterleri

| ID   | Kullanıcı Hikâyesi                         | Kabul Kriteri                                                                       |
| ---- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| US1  | Kullanıcı kayıt olur                       | Email benzersiz olmalı, zayıf parolalar reddedilmeli                                |
| US2  | Kullanıcı giriş yapar                      | Hatalı giriş 401 döner, başarılı giriş JWT token döner                              |
| US3  | Kullanıcı randevu oluşturur                | Creator = current user, invitee var ve overlap kontrolü yapılır                     |
| US4  | Kullanıcı randevularını listeler           | Sadece creator veya invitee olduğu randevular listelenir                            |
| US5  | Kullanıcı randevusunu günceller veya siler | Sadece creator güncelleyebilir veya silebilir                                       |
| US6  | Randevu çakışma kontrolü                   | Overlap varsa 400 döner, overlap kontrolü domain service’te yapılır                 |
| US7  | Realtime bildirim alır                     | Event <1 sn içinde UI’da görünür                                                    |
| US8  | Opsiyonel: WebRTC görüşme                  | Karşı taraf video akışı görünür, oda bazlı bağlantı yapılır                         |
| US9  | Kullanıcı toplantıya katılır               | Video ve ses akışı başarılı, ≥ %80 başarı                                           |
| US10 | Toplantı sahibi kontrol özellikleri        | Katılımcıların durumları UI’da görünür, kontrol edilebilir                          |
| US11 | Toplantı sahibi beyaz tahta başlatır       | Katılımcılar beyaz tahtayı görebilir, yetki verildiğinde eşzamanlı kullanabilir     |
| US12 | Katılımcı beyaz tahta kullanımı            | Sahip tarafından yetkilendirilirse çizim yapılabilir, diğerleri eşzamanlı görebilir |

---

## 4. Veri Modeli

### User

* Id (GUID, PK)
* Email (NVARCHAR, UNIQUE, lowercase normalizasyonu)
* PasswordHash (NVARCHAR)
* Name (NVARCHAR)
* CreatedAt, UpdatedAt (DATETIMEOFFSET)

### Appointment

* Id (GUID, PK)
* Title (NVARCHAR, uzunluk sınırı)
* StartsAt, EndsAt (DATETIMEOFFSET)
* Status (ENUM: scheduled | canceled | done, default scheduled)
* Notes (NVARCHAR(MAX))
* CreatorId (FK → User.Id, NOT NULL)
* InviteeId (FK → User.Id, NOT NULL)
* CreatedAt, UpdatedAt

**İndeksler:** (CreatorId, StartsAt), (InviteeId, StartsAt)

**Çakışma kuralı:**

```
new.StartsAt < existing.EndsAt AND new.EndsAt > existing.StartsAt
```

### Meeting / Conference

* Id (GUID, PK)
* Title (NVARCHAR)
* StartsAt, EndsAt (DATETIMEOFFSET)
* Status (ENUM: scheduled | canceled | done, default scheduled)
* Notes (NVARCHAR(MAX))
* CreatorId (FK → User.Id, NOT NULL)
* Invitees: List<User>
* CreatedAt, UpdatedAt
* VideoSessionId (string, WebRTC session ID)
* WhiteboardSessionId (string, eşzamanlı çizim için)

### Whiteboard Permission

* Id (GUID, PK)
* MeetingId (FK → Meeting.Id)
* UserId (FK → User.Id)
* CanDraw (bool)

---

## 5. Teknik İsterler / Gereksinimler

### Backend (.NET Core + EF Core)

* Onion Architecture: Domain, Application, Infrastructure, API
* JWT Bearer authentication
* Password hash (PasswordHasher)
* Appointment ve Meeting CRUD + overlap kontrolü
* SignalR hub (/ws) ile realtime bildirimler ve toplantı eventleri
* WebRTC signaling (oda bazlı, multi-user)
* Beyaz tahta verilerini SignalR ile sync et
* API p95 gecikme < 150 ms
* CORS: `http://localhost:4200`

### Frontend (Angular + Tailwind / Bootstrap)

* 4 temel ekran: Login/Register, Appointment List, Appointment Detail, Meeting/Toplantı ekranı
* AuthGuard ile yetkisiz erişim engelleme
* Reactive Forms + Validation (email format, zorunlu alan, tarih kontrolü)
* SignalR ile eventleri subscribe et ve UI güncelle
* Toplantı ekranında:

  * Video grid layout (katılımcılar)
  * Kamera/mikrofon açma-kapama
  * Ekran paylaşımı
  * Beyaz tahta, yetkili çizim, eşzamanlı güncelleme

### Veritabanı (MSSQL)

* EF Core migrations
* Meeting ve Whiteboard tabloları
* DATETIMEOFFSET kullanımı
* Index: (CreatorId, StartsAt), (InviteeId, StartsAt)
* Overlap kontrolü için SQL veya domain service

### Opsiyonel WebRTC / Toplantı

* 1:1 veya çoklu katılımcı video
* SignalR ile oda bazlı signaling
* Beyaz tahta eşzamanlı çizim (canvas tabanlı, SignalR üzerinden broadcast)
* Kamera/mikrofon/e-posta paylaşımı kontrolü
* Performans: aynı ağda ≥ %80 başarı

### Güvenlik ve Validasyon

* Password hash ve JWT token
* Data annotation / FluentValidation ile input kontrolü
* Sadece creator veya yetkili kullanıcı toplantı ve beyaz tahta kontrollerini yapabilir

---

## 6. Başarı Metrikleri

* Login testleri ≥ %95 başarı
* CRUD p95 gecikme < 150 ms
* Event teslimi < 1 sn
* Çakışma testi 10/10 doğru
* Demo akışı 2 dakikanın altında
* Toplantı video + whiteboard ≥ %80 başarı

---

## 7. Zaman Çizelgesi (1 Hafta)

| Gün | Yapılacak                                                         |
| --- | ----------------------------------------------------------------- |
| 1   | Proje iskeleti, EF Core + MSSQL migrate, Angular skeleton         |
| 2   | Auth (JWT + PasswordHasher), Login/Register component             |
| 3   | Appointment CRUD + çakışma kontrolü                               |
| 4   | SignalR hub + Angular subscribe, Toplantı eventleri               |
| 5   | WebRTC çoklu video konferans, kamera/mikrofon/ekran paylaşımı     |
| 6   | Beyaz tahta (whiteboard), yetkilendirme, eşzamanlı çizim          |
| 7   | UX, validasyon, Angular form validation, README, demo senaryoları |