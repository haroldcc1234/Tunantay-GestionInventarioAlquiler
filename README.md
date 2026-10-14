# Tunantay Vestuarios

Web de clientes y gestión de vestuarios tradicionales de Jauja, conectadas al mismo inventario MySQL. React, TypeScript, Vite y cinco servicios Express. Diseño en marfil, vino y tonos de tejido, con navegación por texto y sin bibliotecas de iconos.

## Abrir la instalación local

- Clientes: **http://localhost:8080/**
- Personal: **http://localhost:8080/gestion**

La instalación local utiliza el MySQL de Windows en `127.0.0.1:3306`. Las credenciales proporcionadas se encuentran en `.env`, excluido de Git. Las bases de este proyecto son `auth_db`, `inventory_db`, `rental_db`, `returns_db` y `admin_db`; no se modifican las otras bases del equipo.

Desde PowerShell, en esta carpeta:

```powershell
cd services
npm run local
```

El arranque inicia los cinco servicios y sirve la web compilada. Usa el puerto 8080 para la web y 3101–3105 para servicios; el modo local escucha exclusivamente en la computadora. Detener con `Ctrl+C`.

| Perfil de demostración | Correo | Contraseña |
| --- | --- | --- |
| Administrador | admin@tunantay.local | Tunantay2026! |
| Empleado | empleado@tunantay.local | Empleado2026! |

Estas cuentas y los datos iniciales son de demostración, no una instalación publicada en Internet.

## Qué está integrado

El cliente explora el catálogo por región, departamento o nombre, consulta disponibilidad y envía una solicitud con sus fechas. Recibe un código de referencia. La solicitud aparece en **Solicitudes web** dentro de gestión. El personal puede cerrarla, reabrirla o preparar la entrega con el cliente, conjunto y fecha ya seleccionados.

Una solicitud es una consulta de alquiler, **no una reserva garantizada**: no bloquea existencias para fechas futuras ni cobra dinero. El alquiler se confirma cuando se entregan las prendas; entonces se asignan unidades físicas dentro de transacciones. La web refleja la nueva disponibilidad al actualizar su catálogo. Para agrupaciones, se recibe la consulta y la tienda confirma cantidad, tallas y condiciones.

La gestión incluye prendas, accesorios, unidades físicas, conjuntos, clientes, alquileres, pagos parciales, devoluciones, mantenimiento, revisión de daños, autorizaciones de deuda, empleados, configuración, reportes y auditoría. Una cuenta desactivada pierde acceso a las APIs aunque conserve un token anterior. Los daños requieren autorización administrativa.

## Catálogo y datos

- **80 danzas** como selección cultural ampliable, sin afirmar que sean todas las danzas peruanas.
- **80 imágenes almacenadas en MySQL**: 18 fotografías con autor, fuente y licencia, y 62 ilustraciones conceptuales identificadas como tales.
- **240 fichas**, **720 unidades físicas de demostración** y **80 conjuntos**.
- Clientes, alquileres, pagos y daños de ejemplo, identificados como demostración.

Los precios, cantidades físicas y composición de los conjuntos son datos de prueba. Deben contrastarse con el inventario real antes de atender alquileres comerciales. Las fotografías documentan danzas, no necesariamente los trajes específicos de la tienda. Los créditos y enlaces de licencia se muestran en el catálogo. Las referencias culturales están documentadas en comentarios del SQL.

## Instalación en otro equipo con MySQL

Requiere Node.js 22 o superior y MySQL 8 con las credenciales locales configuradas en `.env`.

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix services ci
npm --prefix services run setup
npm --prefix services run local
```

`setup` carga el esquema y la semilla solamente si las cinco bases no contienen tablas. Se detiene si encuentra datos para evitar sobrescribirlos. No volver a ejecutar para actualizar una instalación que ya tiene información. Los cambios de esquema posteriores deben aplicarse mediante una migración revisada y un respaldo previo.

Después de editar el frontend, ejecutar `npm --prefix frontend run build` y recargar el navegador. Después de editar los servicios, detener y volver a ejecutar el arranque local.

## Docker

Se conserva el despliegue autónomo del proyecto con Nginx, cinco servicios, frontend y MySQL en contenedor:

```powershell
docker compose up -d --build
docker compose ps
```

Este modo tiene su propio volumen MySQL y **no comparte los datos con el MySQL de Windows**. No ejecutar ambos modos simultáneamente en el puerto 8080. Para utilizar la conexión local configurada y los datos ya cargados, usar `npm run local`.

La configuración Compose fue validada. No se ha verificado el arranque de contenedores: Docker Desktop no habilitó su motor Linux durante esta sesión. Las pruebas funcionales se ejecutaron contra MySQL local y los servicios Node.

## Pruebas

Con la aplicación local iniciada:

```powershell
cd services
npm test
npm run test:integration
```

Las pruebas de integración se ejecutan explícitamente para evitar escribir datos al correr únicamente las pruebas unitarias. Crean registros identificados `QA-` y eliminan únicamente los IDs creados por esa ejecución. Conservan la auditoría de las operaciones. Se recomienda ejecutarlas en un entorno de prueba, sin operaciones concurrentes del negocio, porque la prueba de tarifas alterna temporalmente la configuración y la restablece.

Verificado el 13 de octubre de 2026:

- Compilación TypeScript y Vite correcta.
- Cinco pruebas unitarias y nueve recorridos de integración, más su contenedor de pruebas: **15 resultados correctos**.
- Validación de las 80 imágenes servidas desde MySQL.
- Autenticación, permisos, desactivación inmediata, altas de inventario y reportes.
- Solicitudes idempotentes, cierre/reapertura y vinculación con alquiler.
- Entregas concurrentes sin duplicar unidades, pagos concurrentes sin sobrepago y revisión simultánea de daños.
- Recorrido visual de solicitud del cliente a preparación de entrega en gestión, búsqueda y revisión responsive.

Esto acredita los casos descritos; no equivale a una prueba de carga ni a una auditoría completa de seguridad o de accesibilidad.

## Estructura

```text
database/       Esquema y datos con imágenes incorporadas
services/       APIs, arranque local, inicialización protegida y pruebas
frontend/       Web de clientes y panel de gestión
gateway/        Enrutamiento para Docker
compose.yaml    Despliegue autónomo en contenedores
.env            Configuración local excluida de Git
```

Los archivos de bloqueo de dependencias permiten instalaciones reproducibles. Los `.dockerignore` evitan incorporar dependencias locales y compilaciones anteriores al contexto de construcción. No se añadieron documentos, capturas o recursos temporales al proyecto.

Para un despliegue público harán falta dominio/HTTPS, credenciales propias, política de tratamiento de datos, copias de seguridad probadas y revisión del inventario comercial. Los pagos registrados son movimientos internos; no hay una pasarela bancaria integrada.
