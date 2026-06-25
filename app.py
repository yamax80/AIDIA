# --- ШАГ 1: Установка инструментов ---
print("🛠️ Установка Cloudflare и библиотек...")
!pip install -q streamlit supabase requests beautifulsoup4
# Скачиваем официальный клиент Cloudflare
!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
!dpkg -i cloudflared-linux-amd64.deb
print("✅ Готово.")

# --- ШАГ 2: Создание файла app.py ---
import os
with open('app.py', 'w') as f:
    f.write(r'''
import streamlit as st
from supabase import create_client
import requests
from bs4 import BeautifulSoup as bs
import re
import uuid

# Подключение
URL = "https://ppzbqkexgbcejgvazhlb.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwemJxa2V4Z2JjZWpndmF6aGxiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTA5NTA2MSwiZXhwIjoyMDk2NjcxMDYxfQ.GfHd1UDEjQtHHpN7IDg02PcShHWc4Cz6slm4bK8jVTE"
supabase = create_client(URL, KEY)

st.set_page_config(layout="wide", page_title="Diafilm Pro Studio", initial_sidebar_state="expanded")

# --- СТИЛИ ---
st.markdown("""<style>
    .stImage > img { border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .frame-card { border: 1px solid #eee; padding: 10px; border-radius: 10px; background: white; margin-bottom: 20px; }
</style>""", unsafe_allow_html=True)

# --- ЗАГРУЗКА ---
@st.cache_data(ttl=5)
def get_films(status):
    return supabase.table("filmstrips").select("*").eq("status", status).order('title').execute().data

st.sidebar.title("🎞️ Студия 2026")
status_filter = st.sidebar.selectbox("Статус", ["pending", "processing", "restored_paid", "restored"])
films = get_films(status_filter)

if films:
    selected_title = st.sidebar.selectbox("Выберите диафильм", [f['title'] for f in films])
    film = next(f for f in films if f['title'] == selected_title)
    f_id = film['id']
    
    tab1, tab2 = st.tabs(["📝 Метаданные и ИИ", "🖼️ Редактор кадров"])

    with t1:
        col1, col2 = st.columns(2)
        with col1:
            u_title = st.text_input("Название", film['title'])
            u_author = st.text_input("Автор", film.get('author') or "")
            u_artist = st.text_input("Художник", film.get('artist') or "")
        with col2:
            u_prompt = st.text_area("Инструкция для ИИ", film.get('custom_prompt') or "")
            u_str = st.slider("Сила (Strength)", 0.1, 0.9, float(film.get('ai_strength') or 0.5))
            
        if st.button("💾 Сохранить изменения"):
            supabase.table("filmstrips").update({
                "title": u_title, "author": u_author, "artist": u_artist,
                "custom_prompt": u_prompt, "ai_strength": u_str
            }).eq("id", f_id).execute()
            st.success("Данные в БД обновлены!")

    with t2:
        # Проверяем кадры
        frames = supabase.table("frames").select("*").eq("filmstrip_id", f_id).order("sort_order", desc=False).execute().data
        
        if not frames:
            st.warning("Кадры еще не импортированы.")
            if st.button("🔍 Импортировать с сайта"):
                with st.spinner("Загрузка..."):
                    resp = requests.get(film['original_url'])
                    soup = bs(resp.text, 'html.parser')
                    box = soup.find('div', id=re.compile(r'news-id-\d+')) or soup.find('div', class_='full-news') or soup.find('body')
                    imgs = [i.get('src') for i in box.find_all('img') if i.get('src') and '/uploads/' in i.get('src')]
                    for i, src in enumerate(list(dict.fromkeys(imgs))):
                        full_src = "https://diafilmy.su" + src if not src.startswith('http') else src
                        supabase.table("frames").insert({
                            "id": str(uuid.uuid4()), "filmstrip_id": f_id, "frame_number": i,
                            "sort_order": float(i), "original_url": full_src, "is_active": True
                        }).execute()
                st.rerun()
        else:
            cols = st.columns(4)
            for idx, fr in enumerate(frames):
                with cols[idx % 4]:
                    st.image(fr['original_url'], use_container_width=True)
                    is_act = fr.get('is_active', True)
                    if st.checkbox("В работу", value=is_act, key=f"a_{fr['id']}") != is_act:
                        supabase.table("frames").update({"is_active": not is_act}).eq("id", fr['id']).execute()
                    
                    c1, c2 = st.columns(2)
                    if c1.button("⬅️", key=f"l_{fr['id']}"):
                        supabase.table("frames").update({"sort_order": fr['sort_order'] - 1.1}).eq("id", fr['id']).execute()
                        st.rerun()
                    if c2.button("➡️", key=f"r_{fr['id']}"):
                        supabase.table("frames").update({"sort_order": fr['sort_order'] + 1.1}).eq("id", fr['id']).execute()
                        st.rerun()
else:
    st.info("Каталог пуст.")
''')

# --- ШАГ 3: Запуск через Cloudflare (Самый стабильный метод) ---
import subprocess
import threading
import time

# Убиваем старые процессы
os.system("pkill streamlit")
os.system("pkill cloudflared")

# Запускаем Streamlit в фоне
def run_streamlit():
    !streamlit run app.py --server.port 8501 --server.address 0.0.0.0 --server.enableCORS false &

threading.Thread(target=run_streamlit, daemon=True).start()
time.sleep(5)

# Запускаем туннель Cloudflare
print("\n🚀 СОЗДАНИЕ ТУННЕЛЬНОЙ ССЫЛКИ...")
!cloudflared tunnel --url http://localhost:8501
