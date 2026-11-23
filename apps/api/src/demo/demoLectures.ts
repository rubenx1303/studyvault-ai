// Videoclases 100 % FICTICIAS para el modo demo. Profesora inventada; ningún estudiante real.
// La transcripción se entrega como "subtítulos de la fuente" para no necesitar audio en la demo.
import type { RecordingAnalysis, TranscriptSegment } from '@studyvault/shared';

interface DemoLecture {
  id: string;
  subject: string;
  unit: string;
  title: string;
  daysAgo: number;
  stage?: 2;
  segments: TranscriptSegment[];
  analysis: Omit<RecordingAnalysis, 'relatedMaterial'>;
}

/** Convierte [["mm:ss", "texto", rol?], ...] en segmentos con fin = inicio del siguiente. */
function seg(rows: [string, string, ('Estudiante' | 'Profesor')?][]): TranscriptSegment[] {
  const toSec = (t: string) => t.split(':').reduce((a, n) => a * 60 + Number(n), 0);
  return rows.map(([t, text, role], i) => ({
    start: toSec(t),
    end: rows[i + 1] ? toSec(rows[i + 1]![0]) : toSec(t) + 20,
    text,
    speaker: role ?? 'Profesor',
  }));
}

const ts = (t: string) => t.split(':').reduce((a, n) => a * 60 + Number(n), 0);

export const DEMO_LECTURES: DemoLecture[] = [
  {
    id: 'lec-ad-ud1',
    subject: 'ad',
    unit: 'ad-1',
    title: 'Clase en directo · Patrón DAO y capas de persistencia',
    daysAgo: 6,
    segments: seg([
      [
        '00:00:05',
        'Buenas tardes a todos. Hoy vamos a ver el patrón DAO, que es la base de toda la unidad uno y de lo que haréis en las siguientes.',
      ],
      [
        '00:00:24',
        'Antes de empezar, un aviso: el caso práctico de la biblioteca se puede entregar hasta el domingo a las once y cincuenta y nueve de la noche.',
      ],
      [
        '00:01:02',
        'Vale. Pensad en una aplicación de escritorio que guarda alumnos. Si en el botón de guardar escribimos directamente la sentencia SQL, ¿qué pasa el día que cambiamos de base de datos?',
      ],
      ['00:01:30', 'Que hay que cambiar todas las pantallas.', 'Estudiante'],
      [
        '00:01:36',
        'Exacto. Eso es el acoplamiento. La lógica de negocio queda pegada a la tecnología de almacenamiento, y cualquier cambio se propaga por toda la aplicación.',
      ],
      [
        '00:02:20',
        'El patrón DAO, Data Access Object, resuelve esto. Un DAO es un objeto cuya única responsabilidad es leer y escribir una entidad en un almacenamiento concreto.',
      ],
      [
        '00:03:05',
        'La clave es la interfaz. Definimos una interfaz AlumnoDao con insertar, buscar por id, listar todos, actualizar y eliminar. Es decir, las operaciones CRUD.',
      ],
      [
        '00:04:10',
        'Y luego tenemos implementaciones: AlumnoDaoJdbc, que habla con MySQL, o AlumnoDaoFichero, que guarda en un CSV. La capa de servicio solo conoce la interfaz.',
      ],
      [
        '00:05:40',
        'Os pongo un ejemplo. Imaginad que hoy guardamos en un fichero y el año que viene la empresa nos pide PostgreSQL. Con DAO escribimos una implementación nueva y el resto del código no se toca.',
      ],
      [
        '00:07:15',
        'Otra ventaja enorme son las pruebas. Podemos crear un DAO en memoria, un mock, y probar la lógica de negocio sin tener una base de datos levantada.',
      ],
      [
        '00:09:02',
        'Mucha gente confunde DAO con Repository. El Repository trabaja como si fuera una colección de objetos del dominio; el DAO está más pegado a la operación de acceso a datos. En Spring Data veréis repositorios.',
      ],
      [
        '00:10:30',
        'Esto os lo digo claramente: la diferencia entre DAO y Repository entra en el examen, así que tenedla clara.',
      ],
      ['00:11:10', 'Profe, ¿la factoría es obligatoria?', 'Estudiante'],
      [
        '00:11:16',
        'Buena pregunta. No es obligatoria. La DaoFactory es opcional: sirve para decidir en tiempo de ejecución qué implementación usar, por ejemplo leyendo un fichero de configuración.',
      ],
      [
        '00:12:40',
        'Inconvenientes: añadimos clases e interfaces, y en un proyecto muy pequeño puede parecer excesivo. Pero en cuanto el proyecto crece, compensa.',
      ],
      [
        '00:14:05',
        'Para el próximo día leed el tema dos, JDBC, sobre todo PreparedStatement y transacciones. Y recordad, la tarea dos se publica el lunes.',
      ],
    ]),
    analysis: {
      summary:
        '## Resumen\nLa clase introduce el **patrón DAO** como solución al acoplamiento entre la lógica de negocio y el almacenamiento. Se explica la estructura (entidad, interfaz DAO con operaciones CRUD, implementaciones como `AlumnoDaoJdbc` o `AlumnoDaoFichero` y una factoría opcional), sus ventajas (cambiar de tecnología sin tocar el resto, pruebas con DAO en memoria) e inconvenientes. Se compara con el patrón Repository.',
      topics: [
        { text: 'Problema del acoplamiento entre negocio y almacenamiento', t: ts('00:01:02') },
        { text: 'Estructura del patrón DAO e interfaz CRUD', t: ts('00:02:20') },
        { text: 'Pruebas con DAO en memoria (mock)', t: ts('00:07:15') },
        { text: 'DAO frente a Repository', t: ts('00:09:02') },
        { text: 'Factoría de DAO (opcional)', t: ts('00:11:16') },
      ],
      concepts: [
        {
          term: 'DAO',
          explanation:
            'Objeto cuya única responsabilidad es leer y escribir una entidad en un almacenamiento concreto.',
          t: ts('00:02:20'),
        },
        {
          term: 'Acoplamiento',
          explanation: 'Dependencia de la lógica de negocio respecto a la tecnología de almacenamiento.',
          t: ts('00:01:36'),
        },
        {
          term: 'Mock / DAO en memoria',
          explanation: 'Implementación falsa para probar la lógica sin base de datos.',
          t: ts('00:07:15'),
        },
      ],
      definitions: [
        {
          term: 'CRUD',
          definition: 'Crear, leer, actualizar y eliminar: operaciones típicas de una interfaz DAO.',
          t: ts('00:03:05'),
        },
        {
          term: 'Repository',
          definition: 'Abstracción que trata los datos como una colección de objetos del dominio.',
          t: ts('00:09:02'),
        },
      ],
      examples: [
        {
          text: 'Migrar de fichero CSV a PostgreSQL escribiendo solo una nueva implementación del DAO.',
          t: ts('00:05:40'),
        },
        {
          text: 'AlumnoDaoJdbc frente a AlumnoDaoFichero detrás de la interfaz AlumnoDao.',
          t: ts('00:04:10'),
        },
      ],
      tasksMentioned: [
        { text: 'Caso práctico de la biblioteca: entrega hasta el domingo a las 23:59.', t: ts('00:00:24') },
        { text: 'La tarea 2 se publicará el lunes.', t: ts('00:14:05') },
      ],
      datesMentioned: [
        { date: 'domingo, 23:59', context: 'Entrega del caso práctico de la biblioteca', t: ts('00:00:24') },
        { date: 'lunes', context: 'Publicación de la tarea 2', t: ts('00:14:05') },
      ],
      notices: [{ text: 'Leer el tema 2 (JDBC): PreparedStatement y transacciones.', t: ts('00:14:05') }],
      examExplicit: [
        {
          statement: 'La diferencia entre DAO y Repository entra en el examen.',
          quote: 'la diferencia entre DAO y Repository entra en el examen',
          t: ts('00:10:30'),
        },
      ],
      importantQuestions: [
        {
          text: '¿Qué ocurre si la lógica de negocio contiene SQL directamente y cambiamos de base de datos?',
          t: ts('00:01:02'),
        },
        { text: '¿Es obligatoria la factoría de DAO?', t: ts('00:11:10') },
      ],
      generatedBy: 'demo-precalculado',
      generatedAt: '2026-10-18T18:00:00Z',
    },
  },
  {
    id: 'lec-ad-ud2',
    subject: 'ad',
    unit: 'ad-2',
    title: 'Clase en directo · JDBC, PreparedStatement y transacciones',
    daysAgo: 1,
    stage: 2,
    segments: seg([
      [
        '00:00:04',
        'Hola, empezamos. Hoy toca JDBC, que es como implementaremos el DAO de la semana pasada contra una base de datos real.',
      ],
      [
        '00:00:40',
        'JDBC tiene cuatro piezas: DriverManager para obtener la conexión, Connection, Statement o PreparedStatement para ejecutar, y ResultSet para recorrer resultados.',
      ],
      ['00:02:15', 'Usad siempre try-with-resources. Así la conexión se cierra aunque salte una excepción.'],
      [
        '00:03:30',
        'Ahora lo importante: nunca concatenéis lo que escribe el usuario en una consulta. Eso permite la inyección SQL. Con PreparedStatement los parámetros van separados con interrogaciones.',
      ],
      [
        '00:05:50',
        'Ejemplo: buscar un alumno por email. ps.setString uno, email, y ejecutamos executeQuery. El driver se encarga de escapar el valor.',
      ],
      [
        '00:08:10',
        'Transacciones. Si damos de alta cien alumnos y falla el cincuenta, ¿queremos cincuenta dentro y cincuenta fuera? No. Queremos todo o nada: atomicidad.',
      ],
      [
        '00:09:00',
        'Se hace con setAutoCommit false, ejecutamos todo, y commit. Si hay error, rollback. Recordad las propiedades ACID.',
      ],
      [
        '00:11:20',
        'Para la tarea dos es obligatorio usar PreparedStatement en todas las consultas y que el alta masiva vaya en una transacción. Fecha de entrega: el treinta y uno de octubre.',
      ],
      [
        '00:12:05',
        'Y un aviso: las credenciales de la base de datos van en un fichero db.properties, que no se entrega. Nada de contraseñas en el código.',
      ],
    ]),
    analysis: {
      summary:
        '## Resumen\nClase sobre **JDBC** como forma de implementar el DAO contra una base de datos: componentes (DriverManager, Connection, PreparedStatement, ResultSet), uso de try-with-resources, prevención de **inyección SQL** con PreparedStatement y **transacciones** (autocommit, commit, rollback, ACID). Incluye requisitos de la tarea 2.',
      topics: [
        { text: 'Componentes de JDBC', t: ts('00:00:40') },
        { text: 'try-with-resources', t: ts('00:02:15') },
        { text: 'Inyección SQL y PreparedStatement', t: ts('00:03:30') },
        { text: 'Transacciones y ACID', t: ts('00:08:10') },
      ],
      concepts: [
        {
          term: 'PreparedStatement',
          explanation: 'Sentencia precompilada con parámetros separados que evita la inyección SQL.',
          t: ts('00:03:30'),
        },
        {
          term: 'Transacción',
          explanation: 'Grupo de operaciones que se ejecutan todas o ninguna.',
          t: ts('00:08:10'),
        },
      ],
      definitions: [
        {
          term: 'Atomicidad',
          definition: 'Todo o nada: si una operación falla, se deshacen todas.',
          t: ts('00:08:10'),
        },
      ],
      examples: [{ text: 'Búsqueda de alumno por email con ps.setString(1, email).', t: ts('00:05:50') }],
      tasksMentioned: [
        { text: 'Tarea 2: PreparedStatement obligatorio y alta masiva en transacción.', t: ts('00:11:20') },
      ],
      datesMentioned: [{ date: '31 de octubre', context: 'Entrega de la tarea 2', t: ts('00:11:20') }],
      notices: [{ text: 'Las credenciales van en db.properties y no se entregan.', t: ts('00:12:05') }],
      examExplicit: [],
      importantQuestions: [
        {
          text: '¿Qué ocurre si una operación falla a mitad de un alta masiva sin transacción?',
          t: ts('00:08:10'),
        },
      ],
      generatedBy: 'demo-precalculado',
      generatedAt: '2026-10-23T18:00:00Z',
    },
  },
];
