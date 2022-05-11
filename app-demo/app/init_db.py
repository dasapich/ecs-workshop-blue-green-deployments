from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
db_uri = os.environ.get("DB_URI")
# "mysql+pymysql://admin:passwd@host:3306/demodb"
database_file = "mysql+pymysql://{}".format(db_uri)
app.config["SQLALCHEMY_DATABASE_URI"] = database_file
db = SQLAlchemy(app)


class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    text = db.Column(db.Text)
    done = db.Column(db.Boolean)
    dateAdded = db.Column(db.DateTime, default=datetime.now())


if __name__ == "__main__":
    db.create_all()
