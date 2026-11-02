<div align="center">

# B-Civil App

Plataforma web para gestionar y documentar obras de ingeniería civil desde el celular.

Bitácora digital · Proyectos y personal · Documentos técnicos en PDF/Word · Asistente con IA

### 🔗 [Ver demo en línea → bitacoradeobra.pages.dev](https://bitacoradeobra.pages.dev/)

![Estado](https://img.shields.io/badge/estado-en%20desarrollo-orange)
![PWA](https://img.shields.io/badge/PWA-instalable-1F3864)
![JavaScript](https://img.shields.io/badge/JavaScript-ES%20Modules-F7DF1E?logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?logo=supabase&logoColor=white)

</div>

---

## ¿Qué problema resuelve?

En obra, la información se pierde: las fotos quedan en el celular, las notas en cuadernos y los informes se redactan a mano al final de la semana. B-Civil reúne todo en un solo lugar: el residente o interventor registra lo que pasa en campo (con fotos y voz), y la plataforma ayuda a convertir esos registros en documentos técnicos listos para entregar.

## Funcionalidades

| Módulo | Qué hace |
|---|---|
| Bitácora de obra | Línea de tiempo de registros por proyecto, con hasta 6 fotografías por registro y notas de voz con transcripción de audio. Exportación de la bitácora. |
| Funcionamiento sin conexión | Si no hay señal en la obra, los registros (texto, fotos y audio) se guardan en el dispositivo y se suben solos cuando vuelve la conexión. |
| Proyectos | Gestión de proyectos, personal asignado y contratos. |
| Generador de documentos | Informes semanales de interventoría, reportes de incapacidad y otros documentos técnicos, con vista previa editable y exportación a PDF y Word con el membrete de la empresa. |
| Asistente con IA | Chat que responde preguntas sobre los registros reales del proyecto (por ejemplo, «¿qué se registró esta semana?») y redacta documentos a partir de ellos. |
| Papelera | Los registros eliminados se pueden recuperar. |
| Cuenta y perfil | Registro por invitación, inicio de sesión, perfil, logo de empresa y configuración. |
| Legal | Términos de uso, política de privacidad y tratamiento de datos. |

## Tecnologías

- Frontend: HTML5, CSS3 y JavaScript (ES Modules), sin frameworks.
- PWA: Service Worker y manifiesto para instalar la app en el celular y usarla sin conexión (cola de registros en IndexedDB).
- Backend como servicio: [Supabase](https://supabase.com) — autenticación, base de datos PostgreSQL, almacenamiento de archivos y funciones Edge.
- Documentos: jsPDF para la generación de PDF.
- IA: funciones Edge de Supabase para el asistente, la generación de documentos y la transcripción de audio.

## Estructura del proyecto

```text
plataforma/
├── index.html          # Pantalla de acceso
├── login.html
├── registro.html       # Registro con código de invitación
├── manifest.json       # Configuración PWA
├── sw.js               # Service Worker
├── app/                # Pantallas de la aplicación
│   ├── dashboard.html
│   ├── proyectos/
│   ├── bitacora/
│   ├── documentos/
│   ├── chat/           # Asistente con IA
│   ├── papelera/
│   ├── perfil.html
│   └── configuracion.html
├── js/                 # Lógica por módulo (auth, bitácora, documentos, chat...)
├── css/                # Estilos
├── img/                # Imágenes e íconos
└── legal/              # Términos, privacidad y tratamiento de datos
```

## Seguridad y privacidad

- Solo el cliente se publica en este repositorio: no hay claves secretas en el código. La clave de Supabase que aparece es la publishable key, pensada para ir en el navegador.
- La protección de los datos se hace en el servidor con Row Level Security de Supabase, de modo que cada usuario solo accede a su información.
- El registro es solo por invitación, validado en el servidor.
- El texto que escribe el usuario se escapa antes de mostrarse, para evitar inyección de código.

## Estado del proyecto

Versión inicial en desarrollo, publicada en [bitacoradeobra.pages.dev](https://bitacoradeobra.pages.dev/). Próximos pasos: pruebas en obra con usuarios reales y más plantillas de documentos.

> Uso solo con invitación. La plataforma es para personas que cuentan con un código de invitación. Para más información o para solicitar acceso, contactar a Pablo Daniel Ávila Wilchez: ingenieroavila055@gmail.com · (+57) 302 839 9281.

## Autor

Pablo Daniel Ávila Wilchez — Ingeniero Civil<br>
Matrícula profesional COPNIA 021037-0852125 ATL

📧 ingenieroavila055@gmail.com · 📱 (+57) 302 839 9281<br>
📍 Agustín Codazzi, Cesar, Colombia · 🔗 [GitHub](https://github.com/pabloavilaw23)

---

<sub>Desarrollado como herramienta de apoyo a la residencia e interventoría de obra, con apoyo de herramientas de Inteligencia Artificial.</sub>
