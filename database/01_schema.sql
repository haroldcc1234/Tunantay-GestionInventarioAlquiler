CREATE DATABASE IF NOT EXISTS auth_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS inventory_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS rental_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS returns_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS admin_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'svc_auth'@'%' IDENTIFIED BY 'local_tunantay_services_change';
CREATE USER IF NOT EXISTS 'svc_inventory'@'%' IDENTIFIED BY 'local_tunantay_services_change';
CREATE USER IF NOT EXISTS 'svc_rental'@'%' IDENTIFIED BY 'local_tunantay_services_change';
CREATE USER IF NOT EXISTS 'svc_returns'@'%' IDENTIFIED BY 'local_tunantay_services_change';
CREATE USER IF NOT EXISTS 'svc_admin'@'%' IDENTIFIED BY 'local_tunantay_services_change';
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_db.* TO 'svc_auth'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_db.* TO 'svc_inventory'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON rental_db.* TO 'svc_rental'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON returns_db.* TO 'svc_returns'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_db.* TO 'svc_admin'@'%';
GRANT SELECT ON auth_db.* TO 'svc_admin'@'%';
GRANT SELECT ON inventory_db.* TO 'svc_admin'@'%';
GRANT SELECT ON rental_db.* TO 'svc_admin'@'%';
GRANT SELECT ON returns_db.* TO 'svc_admin'@'%';

USE auth_db;
CREATE TABLE users (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 full_name VARCHAR(160) NOT NULL,
 email VARCHAR(180) NOT NULL UNIQUE,
 password_hash VARCHAR(200) NOT NULL,
 role ENUM('ADMIN','EMPLEADO') NOT NULL DEFAULT 'EMPLEADO',
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

USE inventory_db;
CREATE TABLE dances (
 id INT AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(150) NOT NULL UNIQUE,
 region VARCHAR(100) NOT NULL,
 department VARCHAR(100) NOT NULL,
 description VARCHAR(400) NOT NULL,
 image_svg LONGTEXT NOT NULL,
 image_data LONGTEXT,
 image_source VARCHAR(600),
 image_license VARCHAR(160),
 image_credit VARCHAR(500) NOT NULL DEFAULT 'Ilustración conceptual original · Tunantay',
 active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE garments (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 sku VARCHAR(36) NOT NULL UNIQUE,
 name VARCHAR(160) NOT NULL,
 type ENUM('PRENDA','ACCESORIO') NOT NULL,
 dance_id INT NOT NULL,
 size VARCHAR(32) NOT NULL DEFAULT 'Única',
 rental_price DECIMAL(10,2) NOT NULL DEFAULT 0,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 CONSTRAINT fk_garment_dance FOREIGN KEY (dance_id) REFERENCES dances(id)
);
CREATE TABLE garment_sets (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(160) NOT NULL,
 dance_id INT NOT NULL,
 size VARCHAR(32) NOT NULL DEFAULT 'Única',
 fixed_price DECIMAL(10,2) NOT NULL DEFAULT 0,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY (dance_id) REFERENCES dances(id)
);
CREATE TABLE set_items (
 set_id BIGINT NOT NULL,
 garment_id BIGINT NOT NULL,
 quantity INT NOT NULL DEFAULT 1,
 PRIMARY KEY (set_id, garment_id),
 FOREIGN KEY (set_id) REFERENCES garment_sets(id),
 FOREIGN KEY (garment_id) REFERENCES garments(id)
);
CREATE TABLE units (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 code VARCHAR(48) NOT NULL UNIQUE,
 garment_id BIGINT NOT NULL,
 state ENUM('AVAILABLE','HELD','RENTED','MAINTENANCE','INACTIVE') NOT NULL DEFAULT 'AVAILABLE',
 conservation ENUM('EXCELENTE','BUENO','REGULAR','DAÑADO') NOT NULL DEFAULT 'BUENO',
 notes VARCHAR(300),
 hold_token VARCHAR(80),
 hold_expires DATETIME,
 rental_id BIGINT,
 last_rental_id BIGINT,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 INDEX idx_units_state (garment_id, state),
 INDEX idx_hold_token (hold_token),
 FOREIGN KEY (garment_id) REFERENCES garments(id)
);

USE rental_db;
CREATE TABLE clients (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 full_name VARCHAR(160) NOT NULL,
 doc_number VARCHAR(25) NOT NULL UNIQUE,
 phone VARCHAR(30),
 email VARCHAR(180),
 address VARCHAR(220),
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE rentals (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 folio VARCHAR(34) NOT NULL UNIQUE,
 request_id VARCHAR(80) UNIQUE,
 hold_token VARCHAR(80),
 client_id BIGINT NOT NULL,
 created_by BIGINT NOT NULL,
 start_at DATETIME NOT NULL,
 due_at DATETIME NOT NULL,
 cutoff_hour TINYINT NOT NULL,
 duration_days INT NOT NULL,
 base_amount DECIMAL(10,2) NOT NULL,
 status ENUM('PENDING','ACTIVE','PARTIAL','RETURNED','CANCELLED') NOT NULL DEFAULT 'PENDING',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (client_id) REFERENCES clients(id),
 INDEX idx_rental_client (client_id, status)
);
CREATE TABLE rental_items (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 rental_id BIGINT NOT NULL,
 unit_id BIGINT NOT NULL,
 garment_name VARCHAR(160) NOT NULL,
 unit_code VARCHAR(48) NOT NULL,
 price DECIMAL(10,2) NOT NULL,
 status ENUM('OUT','RETURNED') NOT NULL DEFAULT 'OUT',
 UNIQUE KEY uq_rental_unit (rental_id, unit_id),
 FOREIGN KEY (rental_id) REFERENCES rentals(id)
);

USE returns_db;
CREATE TABLE return_items (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 rental_id BIGINT NOT NULL,
 rental_item_id BIGINT NOT NULL UNIQUE,
 unit_id BIGINT NOT NULL,
 condition_state ENUM('EXCELENTE','BUENO','REGULAR','DAÑADO') NOT NULL,
 notes VARCHAR(300),
 registered_by BIGINT NOT NULL,
 status ENUM('PENDING','DONE') NOT NULL DEFAULT 'PENDING',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE damages (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 rental_id BIGINT NOT NULL,
 unit_id BIGINT NOT NULL,
 suggested_amount DECIMAL(10,2) NOT NULL,
 approved_amount DECIMAL(10,2),
 status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
 notes VARCHAR(300),
 requested_by BIGINT NOT NULL,
 UNIQUE KEY uq_damage_return (rental_id,unit_id),
 reviewed_by BIGINT,
 reviewed_at DATETIME,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE payments (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 rental_id BIGINT NOT NULL,
 amount DECIMAL(10,2) NOT NULL,
 method ENUM('EFECTIVO','YAPE','PLIN','TRANSFERENCIA') NOT NULL DEFAULT 'EFECTIVO',
 registered_by BIGINT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_pay_rental (rental_id)
);
CREATE TABLE payment_locks (rental_id BIGINT PRIMARY KEY);
CREATE TABLE debt_authorizations (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 client_id BIGINT NOT NULL,
 approved_by BIGINT NOT NULL,
 consumed BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

USE admin_db;
CREATE TABLE settings (
 key_name VARCHAR(70) PRIMARY KEY,
 value_text VARCHAR(255) NOT NULL,
 updated_by BIGINT,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE audit_logs (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 event_id VARCHAR(80) UNIQUE,
 user_id BIGINT NOT NULL,
 action VARCHAR(80) NOT NULL,
 entity VARCHAR(80) NOT NULL,
 entity_id VARCHAR(80) NOT NULL,
 payload JSON,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

USE auth_db;
CREATE TABLE audit_outbox (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 event_id VARCHAR(80) UNIQUE,
 action VARCHAR(80), entity VARCHAR(80), entity_id VARCHAR(80), user_id BIGINT, payload JSON
);
USE inventory_db;
CREATE TABLE audit_outbox LIKE auth_db.audit_outbox;
USE rental_db;
CREATE TABLE audit_outbox LIKE auth_db.audit_outbox;
USE returns_db;
CREATE TABLE audit_outbox LIKE auth_db.audit_outbox;

USE rental_db;
CREATE TABLE IF NOT EXISTS web_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_key VARCHAR(36) NOT NULL UNIQUE,
  reference VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  doc_number VARCHAR(25) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(180),
  set_id BIGINT NOT NULL,
  set_name VARCHAR(160) NOT NULL,
  pickup_date DATE NOT NULL,
  return_date DATE NOT NULL,
  notes VARCHAR(500) NOT NULL DEFAULT '',
  status ENUM('PENDING','CANCELLED') NOT NULL DEFAULT 'PENDING',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_web_status (status,created_at)
);
