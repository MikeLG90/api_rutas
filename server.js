const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app =  express();
const port = 3000;

app.use(cors());
app.use(express.json());

// configuración de base de datos de postgress rutas_up
const pool = new Pool({
  user: 'postgres',           
  host: '10.0.0.19',          
  database: 'rutas_up', 
  password: 'postgres', 
  port: 5432,
});

app.get('/api/rutas-con-paradas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT json_agg(ruta_con_paradas) AS rutas
      FROM (
        SELECT 
          r.*,  
          json_agg(
            json_build_object(
              'id', p.parada_id,
              'ruta_id', p.ruta_id,
              'nombre', p.nombre_parada,
              'latitud', p.latitud,
              'longitud', p.longitud
            )
          ) AS paradas
        FROM rutas_up.rutas r
        LEFT JOIN rutas_up.paradas p ON p.ruta_id = r.ruta_id
        GROUP BY r.ruta_id
      ) AS ruta_con_paradas;
    `);

    res.json(result.rows[0].rutas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener rutas con paradas' });
  }
});

// registrar ubicación (movil - Said)
app.post('/api/ubicacion', async (req, res) => {
    const { ruta_id, vehiculo_id, lng, lat } = req.body // se manda el vehiculo_id y la longitud y latitud
    try {
        await pool.query(
            'INSERT INTO rutas_up.ubicaciones (ruta_id, vehiculo_id, longitud, latitud) VALUES ($1, $2, $3, $4)' ,
            [ ruta_id, vehiculo_id, lng, lat]
        );
        res.status(200).json({ message: 'Ubicación registrada' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al guardar la ubicación' });
    }
});

// ruta para obtener la ubicación de un vehiculo
app.get('/api/vehiculo/:id/ubicacion', async (req, res) => {
  const id = req.params.id;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM rutas_up.ubicaciones WHERE vehiculo_id = $1 ORDER BY timestamp DESC LIMIT 1`,
      [id]
    );
    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.status(404).json({ error: 'Ubicación no encontrada' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar ubicación' });
  }
});



// calcular vehiculo más cercano al usuario con la formula haversine
const haversine = (lat1, lon1, lat2, lon2) => {
  const toRad = x => x * Math.PI / 180;
  const R = 6371e3; // metros
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const velocidadPromedio = 30 * 1000 / 3600; // 30 km/h en metros/segundo (~8.33 m/s)

app.post('/api/ruta/:rutaId/vehiculo-cercano', async (req, res) => {
  const rutaId = req.params.rutaId;
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'Latitud y longitud requeridas' });
  }

  try {
    const { rows } = await pool.query(`
      SELECT v.vehiculo_id AS vehiculo_id, v.placa, u.latitud, u.longitud
      FROM rutas_up.vehiculos v
      JOIN (
        SELECT DISTINCT ON (vehiculo_id) *
        FROM rutas_up.ubicaciones
        ORDER BY vehiculo_id, timestamp DESC
      ) u ON v.vehiculo_id = u.vehiculo_id
      WHERE u.ruta_id = $1
    `, [rutaId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No hay vehículos activos en esta ruta' });
    }

    let masCercano = null;
    let distanciaMin = Infinity;

    for (const row of rows) {
      const distancia = haversine(lat, lng, row.latitud, row.longitud);
      if (distancia < distanciaMin) {
        distanciaMin = distancia;
        const tiempoSegundos = distancia / velocidadPromedio;
        masCercano = { 
          ...row, 
          distancia_metros: distancia,
          tiempo_estimado_segundos: tiempoSegundos
        };
      }
    }

    res.json(masCercano);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular vehículo más cercano' });
  }
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});