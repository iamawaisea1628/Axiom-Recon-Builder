import os
import requests
import jwt
from datetime import datetime, timedelta
from dotenv import load_dotenv
load_dotenv()
SECRET_KEY=os.getenv('SECRET_KEY','development-only-change-me')

def create_token(user_id,email,expires_in_hours=24):
    payload={'user_id':user_id,'email':email,'exp':datetime.utcnow()+timedelta(hours=expires_in_hours),'iat':datetime.utcnow()}
    return jwt.encode(payload,SECRET_KEY,algorithm='HS256')

def verify_token(token):
    supabase_url=os.getenv('SUPABASE_URL')
    publishable_key=os.getenv('SUPABASE_PUBLISHABLE_KEY')
    if supabase_url and publishable_key:
        try:
            response=requests.get(f"{supabase_url}/auth/v1/user",headers={'apikey':publishable_key,'Authorization':f'Bearer {token}'},timeout=8)
            if response.status_code!=200:return None
            user=response.json()
            return {'user_id':user['id'],'email':user.get('email'),'name':user.get('user_metadata',{}).get('full_name') or user.get('email'),'role':'user'}
        except requests.RequestException:return None
    try:return jwt.decode(token,SECRET_KEY,algorithms=['HS256'])
    except (jwt.ExpiredSignatureError,jwt.InvalidTokenError):return None

def validate_email(email):
    import re
    return re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',email) is not None

def validate_password(password):
    if len(password)<8:return False,'Password must be at least 8 characters'
    if not any(c.isupper() for c in password):return False,'Password must contain uppercase letter'
    if not any(c.isdigit() for c in password):return False,'Password must contain number'
    return True,'Password is valid'
