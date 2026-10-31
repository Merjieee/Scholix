CREATE DATABASE IF NOT EXISTS scholix CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE scholix;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(40) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'teacher', 'student') NOT NULL,
    title VARCHAR(190) NOT NULL DEFAULT '',
    student_roll VARCHAR(40) NULL,
    grades_json JSON NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS app_data (
    data_key VARCHAR(40) PRIMARY KEY,
    payload LONGTEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE = InnoDB;
-- Demo accounts: admin123, teacher123, student123. Change these after first sign-in.
INSERT INTO
    users (
        id,
        name,
        email,
        password_hash,
        role,
        title,
        student_roll,
        grades_json
    )
VALUES (
        'u-admin',
        'Rosa Alvarez',
        'admin@scholix.com',
        '$2y$10$CDI0YPnfeTOvH0.BjoeXqOtRt3DF1U1M/e7cS09APj52ik9VoPOre',
        'admin',
        'Registrar · Riverton Campus',
        NULL,
        NULL
    ),
    (
        'u-teacher',
        'Marcus Bell',
        'teacher@scholix.com',
        '$2y$10$Nz4R.9Ed5KltLPO1rA275ut.t1fZc75opSOVasPkbrkB4s6PQRHhC',
        'teacher',
        'Class teacher · Grades 7 & 8',
        NULL,
        '["Grade 7","Grade 8"]'
    ),
    (
        'u-student',
        'Aarav Mehta',
        'student@scholix.com',
        '$2y$10$Vmbe2aJCEc6pT2FHeMHrl.FM8NhDx6t2GBAibgSAXPdSyGIbi2Bz6',
        'student',
        'Student · Grade 6',
        '6A-001',
        NULL
    )
ON DUPLICATE KEY UPDATE
    email = VALUES(email);

INSERT INTO
    app_data (data_key, payload)
VALUES (
        'students',
        '[{"feeStatus":"Paid","enrolled":"2024-06-12","guardian":"Neha Mehta","attendance":96.4,"roll":"6A-001","absences":0,"due":0,"id":1,"name":"Aarav Mehta","phone":"+1 415 555 0134","lateArrivals":0,"email":"aarav.mehta@scholix.com","grade":"Grade 6"},{"feeStatus":"Partial","enrolled":"2024-06-14","guardian":"Imran Khan","attendance":91.2,"roll":"6A-002","absences":0,"due":120,"id":2,"name":"Zoya Khan","phone":"+1 415 555 0177","lateArrivals":0,"email":"zoya.khan@scholix.com","grade":"Grade 6"},{"feeStatus":"Unpaid","enrolled":"2024-06-19","guardian":"Maria Fernandes","attendance":87.5,"roll":"6A-003","absences":0,"due":480,"id":3,"name":"Leo Fernandes","phone":"+1 628 555 0119","lateArrivals":0,"email":"leo.fernandes@scholix.com","grade":"Grade 6"},{"feeStatus":"Paid","enrolled":"2024-06-21","guardian":"Kenji Suzuki","attendance":98.1,"roll":"6B-004","absences":0,"due":0,"id":4,"name":"Hana Suzuki","phone":"+1 510 555 0163","lateArrivals":0,"email":"hana.suzuki@scholix.com","grade":"Grade 6"},{"feeStatus":"Partial","enrolled":"2023-06-08","guardian":"Ada Okoro","attendance":78.9,"roll":"7A-005","absences":0,"due":260,"id":5,"name":"Daniel Okoro","phone":"+1 415 555 0142","lateArrivals":0,"email":"daniel.okoro@scholix.com","grade":"Grade 7"},{"feeStatus":"Paid","enrolled":"2023-06-11","guardian":"Marco Rossi","attendance":94.6,"roll":"7A-006","absences":0,"due":0,"id":6,"name":"Isabella Rossi","phone":"+1 650 555 0188","lateArrivals":0,"email":"isabella.rossi@scholix.com","grade":"Grade 7"},{"feeStatus":"Unpaid","enrolled":"2023-06-12","guardian":"Deepa Rao","attendance":82.3,"roll":"7A-007","absences":0,"due":640,"id":7,"name":"Nikhil Rao","phone":"+1 408 555 0125","lateArrivals":0,"email":"nikhil.rao@scholix.com","grade":"Grade 7"},{"feeStatus":"Paid","enrolled":"2023-06-15","guardian":"Petra Novak","attendance":96.9,"roll":"7B-008","absences":0,"due":0,"id":8,"name":"Amelia Novak","phone":"+1 415 555 0198","lateArrivals":0,"email":"amelia.novak@scholix.com","grade":"Grade 7"},{"feeStatus":"Unpaid","enrolled":"2024-01-09","guardian":"Rosa Alvarez","attendance":69.4,"roll":"7B-009","absences":0,"due":720,"id":9,"name":"Tomas Alvarez","phone":"+1 925 555 0104","lateArrivals":0,"email":"tomas.alvarez@scholix.com","grade":"Grade 7"},{"feeStatus":"Paid","enrolled":"2022-06-10","guardian":"Alice Dubois","attendance":93.1,"roll":"8A-010","absences":0,"due":0,"id":10,"name":"Chloe Dubois","phone":"+1 415 555 0156","lateArrivals":0,"email":"chloe.dubois@scholix.com","grade":"Grade 8"},{"feeStatus":"Partial","enrolled":"2022-06-13","guardian":"Sunita Iyer","attendance":88.7,"roll":"8A-011","absences":0,"due":180,"id":11,"name":"Rohan Iyer","phone":"+1 510 555 0132","lateArrivals":0,"email":"rohan.iyer@scholix.com","grade":"Grade 8"},{"feeStatus":"Paid","enrolled":"2022-06-17","guardian":"Peter Mwangi","attendance":97.3,"roll":"8A-012","absences":0,"due":0,"id":12,"name":"Grace Mwangi","phone":"+1 415 555 0171","lateArrivals":0,"email":"grace.mwangi@scholix.com","grade":"Grade 8"},{"feeStatus":"Unpaid","enrolled":"2023-01-16","guardian":"Freja Berg","attendance":74.8,"roll":"8B-013","absences":0,"due":520,"id":13,"name":"Elias Berg","phone":"+1 650 555 0149","lateArrivals":0,"email":"elias.berg@scholix.com","grade":"Grade 8"},{"feeStatus":"Paid","enrolled":"2022-06-20","guardian":"Dana Goldstein","attendance":90.5,"roll":"8B-014","absences":0,"due":0,"id":14,"name":"Maya Goldstein","phone":"+1 628 555 0121","lateArrivals":0,"email":"maya.goldstein@scholix.com","grade":"Grade 8"},{"feeStatus":"Partial","enrolled":"2021-06-09","guardian":"Ayla Demir","attendance":85.2,"roll":"9A-015","absences":0,"due":300,"id":15,"name":"Yusuf Demir","phone":"+1 415 555 0186","lateArrivals":0,"email":"yusuf.demir@scholix.com","grade":"Grade 9"},{"feeStatus":"Paid","enrolled":"2021-06-11","guardian":"Vikram Sharma","attendance":99.1,"roll":"9A-016","absences":0,"due":0,"id":16,"name":"Priya Sharma","phone":"+1 408 555 0113","lateArrivals":0,"email":"priya.sharma@scholix.com","grade":"Grade 9"},{"feeStatus":"Unpaid","enrolled":"2022-09-05","guardian":"Sean O''Connor","attendance":66.2,"roll":"9A-017","absences":0,"due":840,"id":17,"name":"Liam O''Connor","phone":"+1 925 555 0158","lateArrivals":0,"email":"liam.oconnor@scholix.com","grade":"Grade 9"},{"feeStatus":"Paid","enrolled":"2021-06-14","guardian":"Sara Noor","attendance":92.8,"roll":"9B-018","absences":0,"due":0,"id":18,"name":"Fatima Noor","phone":"+1 415 555 0192","lateArrivals":0,"email":"fatima.noor@scholix.com","grade":"Grade 9"},{"feeStatus":"Paid","enrolled":"2020-06-10","guardian":"Klara Weber","attendance":89.9,"roll":"10A-019","absences":0,"due":0,"id":19,"name":"Jonas Weber","phone":"+1 510 555 0145","lateArrivals":0,"email":"jonas.weber@scholix.com","grade":"Grade 10"},{"feeStatus":"Partial","enrolled":"2020-06-12","guardian":"Raj Patel","attendance":95.7,"roll":"10A-020","absences":0,"due":220,"id":20,"name":"Anika Patel","phone":"+1 650 555 0167","lateArrivals":0,"email":"anika.patel@scholix.com","grade":"Grade 10"},{"feeStatus":"Unpaid","enrolled":"2021-08-23","guardian":"Bola Adeyemi","attendance":71.5,"roll":"10A-021","absences":0,"due":960,"id":21,"name":"Samuel Adeyemi","phone":"+1 415 555 0107","lateArrivals":0,"email":"samuel.adeyemi@scholix.com","grade":"Grade 10"},{"feeStatus":"Paid","enrolled":"2020-06-16","guardian":"Irina Petrova","attendance":97.8,"roll":"10B-022","absences":0,"due":0,"id":22,"name":"Elena Petrova","phone":"+1 628 555 0139","lateArrivals":0,"email":"elena.petrova@scholix.com","grade":"Grade 10"},{"feeStatus":"Partial","enrolled":"2019-06-11","guardian":"Yuki Nakamura","attendance":84.4,"roll":"11A-023","absences":0,"due":400,"id":23,"name":"Kai Nakamura","phone":"+1 408 555 0175","lateArrivals":0,"email":"kai.nakamura@scholix.com","grade":"Grade 11"},{"feeStatus":"Paid","enrolled":"2019-06-13","guardian":"Luca Marchetti","attendance":98.6,"roll":"11A-024","absences":0,"due":0,"id":24,"name":"Sofia Marchetti","phone":"+1 415 555 0128","lateArrivals":0,"email":"sofia.marchetti@scholix.com","grade":"Grade 11"},{"feeStatus":"Unpaid","enrolled":"2020-01-20","guardian":"Layla Farouk","attendance":76.9,"roll":"11B-025","absences":0,"due":1100,"id":25,"name":"Ahmed Farouk","phone":"+1 925 555 0161","lateArrivals":0,"email":"ahmed.farouk@scholix.com","grade":"Grade 11"},{"feeStatus":"Paid","enrolled":"2019-06-18","guardian":"Erik Lindqvist","attendance":93.6,"roll":"11B-026","absences":0,"due":0,"id":26,"name":"Rebecca Lindqvist","phone":"+1 510 555 0194","lateArrivals":0,"email":"rebecca.lindqvist@scholix.com","grade":"Grade 11"}]'
    )
ON DUPLICATE KEY UPDATE
    data_key = VALUES(data_key);