# CineGram

Каталог фильмов и сериалов с отдельными приложениями для macOS, Windows и Android. Приложение запускает локальный сервис на устройстве пользователя; отдельный хостинг не нужен. Для каталога и видео требуется интернет.

## Скачать приложение

Все файлы и инструкция доступны на **[странице релиза CineGram 1.0](https://github.com/arseniy3291/Tg-movies/releases/tag/v1.0.0-apps)**.

| Платформа | Скачать |
| --- | --- |
| macOS — Apple Silicon (M1 и новее) | [DMG](https://github.com/arseniy3291/Tg-movies/releases/download/v1.0.0-apps/CineGram-macOS-AppleSilicon.dmg) |
| macOS — Intel | [DMG](https://github.com/arseniy3291/Tg-movies/releases/download/v1.0.0-apps/CineGram-macOS-Intel.dmg) |
| Windows x64 | [Установщик EXE](https://github.com/arseniy3291/Tg-movies/releases/download/v1.0.0-apps/CineGram-Windows-x64.exe) |
| Android 8 и новее | [Тестовый APK](https://github.com/arseniy3291/Tg-movies/releases/download/v1.0.0-apps/CineGram-Android-preview.apk) |

Это предварительные сборки. На Mac проверен запуск каталога; Windows и Android пока без проверки на реальных устройствах. Сборки Mac и Windows без сертификатов подписи и нотариализации; Android APK подписан тестовым debug-ключом. Автоматического обновления пока нет.

Доступность видео зависит от сторонних источников, региона и сети пользователя. История и избранное хранятся локально.

## iPhone и iPad

Добавлен проект для iOS/iPadOS 16+: **[инструкция по бесплатной установке через Apple ID](apps/ios/README.md)**. Сборка неподписанного IPA запускается в GitHub Actions: **Build CineGram iOS**. IPA нужно подписать своим Apple ID; при бесплатной Personal Team подпись действует 7 дней.

## Разработка

[Устройство приложений, установка и сборка](apps/README.md). Веб-версия запускается командой `npm install` и `npm start`. Сборки приложений также можно запустить вручную в GitHub Actions: workflow **Build CineGram apps**.
