// CLI: `npm run moodle:login` → abre una ventana del navegador para que inicies sesión en tu Moodle.
// El token de la API (servicio móvil de Moodle) se guarda cifrado en la carpeta de datos local (fuera de Git).
// `npm run moodle:login -- --logout` borra el token local.
import { config } from '../../config';
import { SecretStore } from '../../security/secretStore';
import { createMoodleAdapter } from './moodleAdapter';

const adapter = createMoodleAdapter(config.moodle, new SecretStore(config.paths.secrets));

if (process.argv.includes('--logout')) {
  await adapter.logout();
  console.log('Sesión local de Moodle eliminada.');
} else {
  await adapter.login((m) => console.log(`• ${m}`));
  console.log('• Listo: ya puedes sincronizar desde StudyVault.');
  process.exit(0);
}
