# Flujo de Power Automate: avisos de StudyVault

**Qué hace:** cuando StudyVault detecta una novedad en el campus (tarea nueva, cambio de fecha, aviso del profesorado, documento o videoclase), Power Automate:

1. te envía una **notificación al móvil** (app Power Automate);
2. si es una tarea con fecha, crea un **evento en tu calendario de Outlook** y una **tarea en Microsoft To Do** con esa fecha.

**Coste:** 0 €. Solo conectores **estándar** (OneDrive, Notificaciones, Outlook, To Do), incluidos en la mayoría de cuentas Microsoft 365 educativas. No usa el disparador HTTP, que es de pago.

## Cómo encaja

```
StudyVault (tu PC) ──sincroniza el campus──► detecta novedades
      │
      └─► escribe 1 JSON por novedad en  OneDrive\StudyVault\Avisos   (solo metadatos)
                                   │  (sincronización de OneDrive)
                                   ▼
Power Automate  «Cuando se crea un archivo» → Analizar JSON → Notificación / Calendario / To Do
```

StudyVault no conoce Power Automate: solo deja ficheros en una carpeta (**patrón outbox**). Por eso se puede cambiar de herramienta sin tocar la app. La carpeta se configura con `POWER_AUTOMATE_OUTBOX`. Por defecto, en modo personal, es `StudyVault\Avisos` dentro del OneDrive para la Empresa (variable `OneDriveCommercial`), o del OneDrive personal si el primero no está sincronizado. Con `off` se desactiva. Los ficheros se borran solos a los 30 días.

**Privacidad:** cada fichero lleva solo tipo, título, asignatura, fecha de entrega, enlace al campus y una frase resumen. **Nunca** documentos, enunciados ni el cuerpo de los mensajes (hay un test que lo comprueba).

### Ejemplo de evento

```json
{
  "schema": "studyvault.event.v1",
  "id": "chg-17",
  "type": "task.due_changed",
  "title": "Tarea 2 · DAO con JDBC",
  "subject": "Acceso a Datos",
  "dueAt": "2026-10-31T21:00:00.000Z",
  "url": "https://moodle.example.edu/mod/assign/view.php?id=…",
  "createdAt": "2026-10-24T20:24:09.000Z",
  "summary": "Fecha de entrega cambiada (Acceso a Datos): Tarea 2 · DAO con JDBC · entrega 31 oct, 22:00"
}
```

`type` puede ser: `task.new`, `task.due_changed`, `document.new`, `document.modified`, `message.new`, `recording.new`.

## Crear el flujo (unos 10 minutos)

1. Entra en <https://make.powerautomate.com> con tu cuenta de Microsoft 365 → **Crear** → **Flujo de nube automatizado**.
2. **Disparador:** _OneDrive para la Empresa_ → **Cuando se crea un archivo** (con tu cuenta de Microsoft 365). Carpeta: `/StudyVault/Avisos`. Para que StudyVault pueda escribir ahí, añade esa cuenta a la app de OneDrive del PC (Configuración → Cuenta → Agregar una cuenta): StudyVault detecta esa carpeta automáticamente.
3. **Acción:** _Operaciones de datos_ → **Analizar JSON**.
   - Contenido: `@{triggerBody()}`, el contenido del archivo. Si llega en base64, usa `@{base64ToString(triggerBody()?['$content'])}`.
   - Esquema: pega el de abajo.
4. **Acción:** _Notificaciones_ → **Enviarme una notificación móvil**.
   - Texto: `summary`. Vínculo: `url`. Texto del vínculo: `Abrir en el campus`.
5. **Condición:** `dueAt` _no es igual a_ (vacío) **y** `type` _empieza por_ `task.`.
   - **Sí →** _Office 365 Outlook_ → **Crear evento (V4)**:
     - Asunto: `📌 summary`.
     - Inicio: `addHours(body('Analizar_JSON')?['dueAt'], -1)`. Fin: `dueAt`.
     - Zona horaria: (UTC+01:00) Madrid. Cuerpo: `url`.
   - **Sí →** _Microsoft To Do_ → **Agregar una tarea pendiente (V3)**:
     - Lista: _Tareas_. Título: `title (subject)`.
     - Vencimiento: `dueAt`. Nota: `url`.
6. **Guardar** → **Probar** → _Manualmente_. Para disparar una prueba, copia un JSON de ejemplo en `OneDrive\StudyVault\Avisos` con otro nombre.

### Esquema para «Analizar JSON»

```json
{
  "type": "object",
  "properties": {
    "schema": { "type": "string" },
    "id": { "type": "string" },
    "type": { "type": "string" },
    "title": { "type": "string" },
    "subject": { "type": ["string", "null"] },
    "dueAt": { "type": ["string", "null"] },
    "url": { "type": ["string", "null"] },
    "createdAt": { "type": "string" },
    "summary": { "type": "string" }
  },
  "required": ["schema", "id", "type", "title", "summary"]
}
```

## Notas

- **Control de inundación:** la primera importación no genera avisos, y si una sincronización trae más de 10 novedades se envía un único aviso resumen.
- **Nombre del fichero:** StudyVault nombra cada fichero con el resumen del aviso, así un flujo mínimo puede usar el **nombre del archivo** como texto de la notificación sin analizar el JSON.
- **Para recibir las notificaciones** hace falta la app **Power Automate** en el móvil, con la misma cuenta iniciada.
- **Equivalente en Azure:** el mismo evento podría publicarse en **Service Bus** o **Event Grid** y consumirse con una **Logic App** o una **Function**.
