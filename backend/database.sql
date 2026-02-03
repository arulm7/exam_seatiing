CREATE DATABASE IF NOT EXISTS exam_db;

USE exam_db; 

CREATE TABLE IF NOT EXISTS exam_allocation (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reg_no VARCHAR(50) NOT NULL,
    student_name VARCHAR(100) NOT NULL,
    course_code VARCHAR(20) NOT NULL,
    course_name VARCHAR(100) NOT NULL,
    session VARCHAR(50), 
    exam_time varchar(255),
    room VARCHAR(50) NOT NULL,
    seat_row INT NOT NULL,
    seat_column INT NOT NULL,
    exam_date DATE NOT NULL,
    exam_type VARCHAR(100)
);


