// Contenido 100 % FICTICIO para el modo demo/entrevista. Redactado para StudyVault; no procede de ningún campus real.
// Profesores, avisos y tareas son inventados.

export interface DemoDoc {
  id: string;
  subject: string;
  unit: string;
  title: string;
  filename: string; // .pdf → páginas; .docx → secciones
  pages: string[]; // en PDF cada elemento es una página; en DOCX, secciones "## Título\ntexto"
  stage?: 2; // solo aparece a partir de la 2.ª sincronización (para mostrar "novedades")
}

export const DEMO_SUBJECTS = [
  { id: 'ad', name: 'Acceso a Datos', short: 'AD', teachers: ['Laura Méndez (ficticia)'] },
  { id: 'prog', name: 'Programación', short: 'PRG', teachers: ['Javier Ortega (ficticio)'] },
  { id: 'di', name: 'Desarrollo de Interfaces', short: 'DI', teachers: ['Marta Ruiz (ficticia)'] },
];

export const DEMO_UNITS = [
  { id: 'ad-1', subject: 'ad', name: 'UD1 · Persistencia y patrón DAO', position: 1 },
  { id: 'ad-2', subject: 'ad', name: 'UD2 · JDBC y bases de datos relacionales', position: 2 },
  { id: 'ad-3', subject: 'ad', name: 'UD3 · Mapeo objeto-relacional (ORM)', position: 3 },
  { id: 'prog-1', subject: 'prog', name: 'UD1 · Fundamentos de Java', position: 1 },
  { id: 'prog-3', subject: 'prog', name: 'UD3 · Programación orientada a objetos', position: 3 },
  { id: 'di-1', subject: 'di', name: 'UD1 · Interfaces gráficas con JavaFX', position: 1 },
];

export const DEMO_DOCS: DemoDoc[] = [
  {
    id: 'ad-ud1-tema',
    subject: 'ad',
    unit: 'ad-1',
    title: 'Tema UD1 · Persistencia y patrón DAO',
    filename: 'Tema_UD1_Persistencia_DAO.pdf',
    pages: [
      `Unidad 1. Persistencia de datos y patrón DAO

1. Introducción a la persistencia
La persistencia es la capacidad de una aplicación para conservar su información más allá del tiempo de ejecución del programa. Cuando una aplicación se cierra, los objetos que estaban en memoria desaparecen; para recuperarlos más tarde es necesario almacenarlos en un soporte permanente: ficheros, bases de datos relacionales, bases de datos NoSQL o servicios remotos.

En el desarrollo de aplicaciones multiplataforma la persistencia aparece en casi todos los proyectos: una agenda que guarda contactos, una aplicación de inventario o un videojuego que almacena partidas.

2. Formas de persistencia
- Ficheros de texto y binarios (lectura y escritura con flujos).
- Ficheros estructurados: XML y JSON.
- Bases de datos relacionales mediante JDBC.
- Mapeo objeto-relacional (ORM) con herramientas como Hibernate o JPA.
- Bases de datos orientadas a documentos.`,
      `3. El problema del acoplamiento
Si el código de negocio contiene directamente sentencias SQL, nombres de tablas o rutas de ficheros, cualquier cambio en el sistema de almacenamiento obliga a modificar muchas clases. Este acoplamiento dificulta las pruebas, el mantenimiento y la evolución de la aplicación.

4. El patrón DAO (Data Access Object)
El patrón DAO separa la lógica de negocio de la lógica de acceso a datos. Un DAO es un objeto cuya única responsabilidad es leer y escribir entidades en un sistema de almacenamiento concreto, ofreciendo al resto de la aplicación una interfaz sencilla e independiente de la tecnología.

Elementos del patrón DAO:
- Entidad o DTO: clase que representa los datos (por ejemplo, Alumno con id, nombre y email).
- Interfaz DAO: declara las operaciones disponibles (insertar, buscarPorId, listarTodos, actualizar, eliminar).
- Implementación DAO: implementa la interfaz para una tecnología concreta (AlumnoDaoJdbc, AlumnoDaoFichero).
- Factoría (opcional): decide qué implementación usar en tiempo de ejecución.`,
      `5. Ejemplo de interfaz DAO en Java

public interface AlumnoDao {
    void insertar(Alumno a);
    Optional<Alumno> buscarPorId(int id);
    List<Alumno> listarTodos();
    void actualizar(Alumno a);
    void eliminar(int id);
}

La capa de servicio trabaja siempre contra la interfaz AlumnoDao. Si mañana se cambia MySQL por PostgreSQL, o un fichero por una base de datos, solo se escribe una nueva implementación: el resto del código no cambia.

6. Ventajas del patrón DAO
- Bajo acoplamiento entre negocio y almacenamiento.
- Facilita las pruebas unitarias: se puede sustituir el DAO real por un DAO en memoria (mock).
- Centraliza el acceso a datos y la gestión de errores.
- Permite cambiar de tecnología de persistencia con un impacto mínimo.

7. Inconvenientes
- Añade clases e interfaces adicionales.
- En proyectos muy pequeños puede parecer excesivo.`,
      `8. DAO y operaciones CRUD
CRUD son las siglas de Create, Read, Update y Delete: crear, leer, actualizar y borrar. Un DAO suele ofrecer exactamente estas operaciones para cada entidad del dominio.

9. Relación con otros patrones
- Patrón Repository: muy similar al DAO, pero orientado a colecciones de objetos del dominio; es habitual en Spring Data.
- Patrón Singleton: a veces se usa para compartir una única conexión o una única factoría de DAO.
- Patrón Factory: la DaoFactory decide la implementación concreta.

10. Resumen
El patrón DAO encapsula el acceso a datos detrás de una interfaz. La aplicación pide "guarda este alumno" sin saber si se guarda en un fichero, en MySQL o en la nube. Es uno de los patrones más preguntados en el examen de la unidad.`,
    ],
  },
  {
    id: 'ad-ud1-caso',
    subject: 'ad',
    unit: 'ad-1',
    title: 'Caso práctico 1 · Biblioteca con DAO',
    filename: 'Caso1_UD1_Biblioteca.docx',
    pages: [
      `## Planteamiento
Una biblioteca municipal quiere una aplicación de escritorio para gestionar sus libros. Actualmente guarda los datos en un fichero CSV, pero el próximo curso quiere migrar a una base de datos relacional. Se pide diseñar la capa de acceso a datos para que la migración no obligue a reescribir la aplicación.`,
      `## Requisitos
1. Crear la entidad Libro con isbn, título, autor y año de publicación.
2. Definir la interfaz LibroDao con las operaciones CRUD y una búsqueda por autor.
3. Implementar LibroDaoCsv, que lee y escribe el fichero libros.csv.
4. Preparar una clase DaoFactory que devuelva la implementación configurada.
5. Explicar por qué este diseño facilita la futura migración a JDBC.`,
      `## Pistas
Recuerda que la capa de servicio nunca debe conocer el formato CSV. Piensa en qué ocurriría si la búsqueda por autor estuviera escrita directamente en la interfaz gráfica. Revisa los apartados 4 y 6 del tema sobre las ventajas del patrón DAO.`,
    ],
  },
  {
    id: 'ad-ud2-tema',
    subject: 'ad',
    unit: 'ad-2',
    title: 'Tema UD2 · JDBC',
    filename: 'Tema_UD2_JDBC.pdf',
    pages: [
      `Unidad 2. Acceso a bases de datos relacionales con JDBC

1. ¿Qué es JDBC?
JDBC (Java Database Connectivity) es la API estándar de Java para conectarse a bases de datos relacionales y ejecutar sentencias SQL. Cada fabricante proporciona un driver JDBC que traduce las llamadas de la API al protocolo de su base de datos.

2. Componentes principales
- DriverManager: obtiene conexiones a partir de una URL JDBC.
- Connection: representa una sesión con la base de datos.
- Statement y PreparedStatement: ejecutan sentencias SQL.
- ResultSet: permite recorrer los resultados de una consulta fila a fila.`,
      `3. Conexión a la base de datos

String url = "jdbc:mysql://localhost:3306/instituto";
try (Connection con = DriverManager.getConnection(url, usuario, clave)) {
    // operaciones
}

El bloque try-with-resources garantiza que la conexión se cierra aunque se produzca una excepción. Las credenciales nunca deben escribirse en el código: se leen de un fichero de configuración o de variables de entorno.

4. PreparedStatement e inyección SQL
Construir consultas concatenando texto introducido por el usuario es peligroso: permite la inyección SQL. PreparedStatement precompila la sentencia y envía los parámetros por separado:

PreparedStatement ps = con.prepareStatement("SELECT * FROM alumno WHERE email = ?");
ps.setString(1, email);
ResultSet rs = ps.executeQuery();`,
      `5. Transacciones
Una transacción agrupa varias operaciones que deben ejecutarse todas o ninguna (atomicidad). En JDBC se desactiva el autocommit con con.setAutoCommit(false), se ejecutan las operaciones y se confirma con con.commit(). Si ocurre un error se deshace todo con con.rollback().

Propiedades ACID: atomicidad, consistencia, aislamiento y durabilidad.

6. JDBC dentro de un DAO
La implementación AlumnoDaoJdbc encapsula todo el código JDBC: abrir la conexión, preparar sentencias, transformar cada fila del ResultSet en un objeto Alumno y gestionar las SQLException. Así la capa de negocio sigue sin conocer SQL.

7. Pool de conexiones
Abrir una conexión es costoso. Un pool de conexiones (por ejemplo HikariCP) mantiene conexiones abiertas y las reutiliza, mejorando el rendimiento de aplicaciones con muchos usuarios.`,
    ],
  },
  {
    id: 'ad-ud2-tarea',
    subject: 'ad',
    unit: 'ad-2',
    title: 'Tarea 2 · DAO con JDBC',
    filename: 'Tarea2_UD2_DAO_JDBC.docx',
    pages: [
      `## Enunciado
Implementa la clase AlumnoDaoJdbc que cumpla la interfaz AlumnoDao vista en la unidad 1, utilizando una base de datos MySQL o SQLite.`,
      `## Requisitos mínimos
- Uso obligatorio de PreparedStatement en todas las consultas.
- Gestión de recursos con try-with-resources.
- La operación de alta masiva de alumnos debe ejecutarse dentro de una transacción.
- Las credenciales de la base de datos se leerán de un fichero db.properties que no se entrega.`,
      `## Entrega
Proyecto comprimido con el código fuente y un breve documento PDF explicando el diseño. Se valorará la separación en capas y el tratamiento de errores.`,
    ],
  },
  {
    id: 'ad-ud3-tema',
    subject: 'ad',
    unit: 'ad-3',
    title: 'Tema UD3 · ORM e Hibernate',
    filename: 'Tema_UD3_ORM_Hibernate.pdf',
    stage: 2,
    pages: [
      `Unidad 3. Mapeo objeto-relacional

1. El desajuste objeto-relacional
Los lenguajes orientados a objetos trabajan con clases, herencia y referencias, mientras que las bases de datos relacionales trabajan con tablas, filas y claves foráneas. Traducir entre ambos mundos a mano con JDBC es repetitivo. Este problema se conoce como desajuste de impedancia objeto-relacional.

2. ¿Qué es un ORM?
Un ORM (Object-Relational Mapping) es una herramienta que convierte automáticamente objetos en filas y filas en objetos. En Java el estándar es JPA (Jakarta Persistence) y la implementación más conocida es Hibernate.`,
      `3. Anotaciones básicas de JPA
@Entity marca una clase como entidad persistente. @Id indica la clave primaria y @GeneratedValue cómo se genera. @Column permite configurar columnas y @OneToMany, @ManyToOne o @ManyToMany describen relaciones.

4. EntityManager
El EntityManager gestiona el ciclo de vida de las entidades: persist, find, merge y remove. Las consultas se pueden escribir en JPQL, un lenguaje parecido a SQL que trabaja con entidades en lugar de tablas.

5. ORM y DAO
Un ORM no elimina el patrón DAO: lo simplifica. La implementación AlumnoDaoJpa delega en el EntityManager y reduce drásticamente el código respecto a JDBC.`,
    ],
  },
  {
    id: 'prog-ud3-tema',
    subject: 'prog',
    unit: 'prog-3',
    title: 'Tema UD3 · Programación orientada a objetos',
    filename: 'Tema_UD3_POO.pdf',
    pages: [
      `Unidad 3. Programación orientada a objetos

1. Clases y objetos
Una clase es una plantilla que define atributos (estado) y métodos (comportamiento). Un objeto es una instancia concreta de una clase creada con new.

2. Encapsulación
La encapsulación consiste en ocultar el estado interno de un objeto y exponer solo las operaciones necesarias. Los atributos se declaran private y se accede a ellos mediante métodos públicos (getters y setters) que pueden validar los datos.`,
      `3. Herencia
La herencia permite crear una clase nueva (subclase) a partir de otra existente (superclase), reutilizando sus atributos y métodos. En Java se indica con extends y solo existe herencia simple de clases.

public class Empleado extends Persona { ... }

La subclase puede sobrescribir métodos (@Override) para especializar su comportamiento y llamar a la versión de la superclase con super. Los constructores no se heredan: el constructor de la subclase invoca al de la superclase con super(...) como primera instrucción.

4. Clases abstractas
Una clase abstracta (abstract) no se puede instanciar y puede contener métodos abstractos sin implementación que las subclases están obligadas a implementar.`,
      `5. Polimorfismo
El polimorfismo permite tratar objetos de distintas subclases a través de una referencia de la superclase o de una interfaz. La llamada a un método sobrescrito ejecuta la versión del objeto real (enlace dinámico).

List<Figura> figuras = List.of(new Circulo(2), new Cuadrado(3));
for (Figura f : figuras) System.out.println(f.area());

6. Interfaces
Una interfaz define un contrato de métodos que una clase se compromete a implementar (implements). Una clase puede implementar varias interfaces, lo que compensa la ausencia de herencia múltiple. Las interfaces son la base de patrones como DAO.

7. Errores frecuentes en el examen
- Confundir sobrecarga (mismo nombre, distintos parámetros) con sobrescritura (misma firma en la subclase).
- Olvidar que los atributos private no son accesibles directamente desde la subclase.
- Pensar que una clase puede extender varias clases a la vez.`,
    ],
  },
  {
    id: 'prog-ud3-ejercicios',
    subject: 'prog',
    unit: 'prog-3',
    title: 'Ejercicios UD3 · Herencia y polimorfismo',
    filename: 'Ejercicios_UD3_Herencia.docx',
    pages: [
      `## Ejercicio 1
Crea la jerarquía Vehiculo → Coche y Moto. Vehiculo tendrá matrícula y un método abstracto calcularImpuesto(). Cada subclase lo implementará de forma distinta.`,
      `## Ejercicio 2
Crea una lista de Vehiculo con coches y motos y calcula el impuesto total recorriéndola. Explica qué concepto de la programación orientada a objetos estás aplicando.`,
      `## Ejercicio 3
Añade una interfaz Electrico con el método nivelBateria() e impleméntala solo en algunos vehículos. Razona por qué no podría resolverse con herencia de clases.`,
    ],
  },
  {
    id: 'prog-ud1-tema',
    subject: 'prog',
    unit: 'prog-1',
    title: 'Tema UD1 · Fundamentos de Java',
    filename: 'Tema_UD1_Fundamentos_Java.pdf',
    pages: [
      `Unidad 1. Fundamentos de Java

1. La plataforma Java
Java es un lenguaje compilado a bytecode que se ejecuta sobre la máquina virtual de Java (JVM). Gracias a ello, el mismo programa funciona en Windows, Linux o macOS: "escribe una vez, ejecuta en cualquier lugar".

2. Tipos de datos
Tipos primitivos: byte, short, int, long, float, double, char y boolean. Los tipos referencia (String, arrays, objetos) almacenan una referencia a un objeto en memoria.

3. Estructuras de control
Condicionales if/else y switch; bucles for, while y do-while. Desde Java 14 existen las expresiones switch con flecha.`,
      `4. Excepciones
Una excepción es un evento que interrumpe el flujo normal del programa. Se capturan con try/catch/finally. Las excepciones comprobadas (checked), como IOException o SQLException, deben capturarse o declararse con throws.

5. Colecciones
List (ArrayList, LinkedList), Set (HashSet, TreeSet) y Map (HashMap, TreeMap) permiten almacenar grupos de objetos. Los genéricos (List<String>) aportan seguridad de tipos en tiempo de compilación.`,
    ],
  },
  {
    id: 'di-ud1-tema',
    subject: 'di',
    unit: 'di-1',
    title: 'Tema UD1 · JavaFX y MVC',
    filename: 'Tema_UD1_JavaFX_MVC.pdf',
    pages: [
      `Unidad 1. Interfaces gráficas con JavaFX

1. Estructura de una aplicación JavaFX
Una aplicación JavaFX extiende la clase Application e implementa el método start(Stage). El Stage es la ventana; la Scene contiene el grafo de nodos (controles y contenedores).

2. FXML y Scene Builder
FXML es un lenguaje basado en XML para describir la interfaz separada del código. Scene Builder permite diseñarla de forma visual. El controlador asociado recibe los componentes mediante la anotación @FXML.`,
      `3. Patrón Modelo-Vista-Controlador (MVC)
- Modelo: datos y lógica de negocio (por ejemplo, la lista de alumnos obtenida a través de un DAO).
- Vista: la interfaz (FXML).
- Controlador: responde a los eventos del usuario y coordina modelo y vista.

4. Propiedades y binding
JavaFX ofrece propiedades observables (StringProperty, IntegerProperty) que permiten enlazar (bind) controles con datos: cuando cambia el dato, la interfaz se actualiza sola.

5. Usabilidad
Una buena interfaz es consistente, ofrece retroalimentación inmediata, previene errores y es accesible (contraste, navegación por teclado, textos alternativos).`,
    ],
  },
];

export interface DemoTask {
  id: string;
  subject: string;
  unit: string;
  title: string;
  html: string;
  dueInDays: number;
  dueInDaysStage2?: number;
  attachment?: string;
}

export const DEMO_TASKS: DemoTask[] = [
  {
    id: 't-ad-2',
    subject: 'ad',
    unit: 'ad-2',
    title: 'Tarea 2 · DAO con JDBC',
    html: '<p>Implementa <strong>AlumnoDaoJdbc</strong> siguiendo el enunciado adjunto. Usa PreparedStatement y transacciones.</p>',
    dueInDays: 4,
    dueInDaysStage2: 7,
    attachment: 'ad-ud2-tarea',
  },
  {
    id: 't-ad-1',
    subject: 'ad',
    unit: 'ad-1',
    title: 'Caso práctico 1 · Biblioteca',
    html: '<p>Resuelve el caso práctico de la biblioteca aplicando el patrón DAO.</p>',
    dueInDays: -3,
    attachment: 'ad-ud1-caso',
  },
  {
    id: 't-prog-3',
    subject: 'prog',
    unit: 'prog-3',
    title: 'Práctica UD3 · Jerarquía de vehículos',
    html: '<p>Entrega resueltos los ejercicios 1 a 3 de la unidad sobre herencia y polimorfismo.</p>',
    dueInDays: 9,
    attachment: 'prog-ud3-ejercicios',
  },
  {
    id: 't-di-1',
    subject: 'di',
    unit: 'di-1',
    title: 'Tarea 1 · Formulario JavaFX con MVC',
    html: '<p>Diseña un formulario de alta de alumnos en FXML con validación y binding de propiedades.</p>',
    dueInDays: 14,
  },
];

export const DEMO_MESSAGES = [
  {
    id: 'm1',
    subject: 'ad',
    author: 'Laura Méndez (ficticia)',
    title: 'Se amplía el plazo de la Tarea 2',
    html: '<p>Hola a todos. Por la incidencia del servidor, <strong>se amplía el plazo de la Tarea 2 hasta el viernes</strong>. Revisad el apartado de transacciones del tema 2.</p>',
    daysAgo: 0,
    stage: 2 as const,
  },
  {
    id: 'm2',
    subject: 'prog',
    author: 'Javier Ortega (ficticio)',
    title: 'Repaso para el examen',
    html: '<p>Recordad estudiar las unidades 1 a 3 para el examen. Prestad especial atención a herencia, polimorfismo e interfaces.</p>',
    daysAgo: 1,
  },
  {
    id: 'm3',
    subject: 'di',
    author: 'Marta Ruiz (ficticia)',
    title: 'Material de Scene Builder',
    html: '<p>He subido una guía rápida de Scene Builder en la unidad 1.</p>',
    daysAgo: 4,
  },
  {
    id: 'm4',
    subject: 'ad',
    author: 'Laura Méndez (ficticia)',
    title: 'Nueva unidad publicada: ORM',
    html: '<p>Ya tenéis disponible el tema de la unidad 3 sobre mapeo objeto-relacional e Hibernate.</p>',
    daysAgo: 0,
    stage: 2 as const,
  },
];
