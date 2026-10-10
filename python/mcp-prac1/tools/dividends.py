from bs4 import BeautifulSoup as BS
from tabulate import tabulate
from sys import argv
from datetime import date
from time import sleep
from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


def get_dividends(filename=""):
    if filename:
        html = open(filename, 'r', encoding='utf-8').read()
    elif len(argv) > 1:
        html = open(argv[1], 'r', encoding='utf-8').read()
    else:
        html = open('C:\\Users\\nagap\\Downloads\\dividends-25-07-25.htm', 'r', encoding='utf-8').read()

    soup = BS(html, 'html.parser')

    stock_cards = soup.find_all('div', class_='lhsGrayCard_web_lhsGrayCard__RSkQw')

    data = []
    columns = ["Stock Name", "LTP", "Dividend (Rs.)", "Div %", "Announcement Date", "Ex-Date"]

    for card in stock_cards:
        try:
            name = card.find('a', class_='lhsGrayCard_web_title__B2NJA').get_text(strip=True)
            ltp = card.find('span', class_='lhsGrayCard_web_ltpText__QNAIT').find_next('span').get_text(strip=True).replace(',', '')
            dividend = card.find_all('span', class_='lhsGrayCard_web_values__DQOxi')[1].get_text(strip=True).replace(',', '')
            if dividend == '-':
                continue
            ann_date = card.find_all('span', string='Announcement Date')[0].find_next('span').get_text(strip=True)
            ex_date = card.find_all('span', string='Ex-Date')[0].find_next('span').get_text(strip=True)

            """data.append({
                "Stock Name": name,
                "LTP": ltp,
                "Dividend (Rs.)": dividend,
                "Announcement Date": ann_date,
                "Ex-Date": ex_date
            })
            """
            dividend_percentage = round(float(dividend) / float(ltp) * 100, 2)
            data.append([name, ltp, dividend, dividend_percentage, ann_date, ex_date])
        except Exception as e:
            print(f"Skipping card due to error: {e}")
            continue

    #print(tabulate(sorted(data, key = lambda x: x[3]), headers=columns, tablefmt='pretty', stralign='center', numalign='center'))
    return sorted(data, key = lambda x: x[3])

def fetch_dividend_data():
    driver = webdriver.Chrome()
    actions = ActionChains(driver)
    driver.get("https://www.moneycontrol.com/markets/corporate-action/dividends_declared/")

    driver.implicitly_wait(60)

    for _ in range(20):
        actions.send_keys(Keys.PAGE_DOWN).perform()
        sleep(1)

    filename = f"dividends-{date.today().strftime('%d-%m-%Y')}.htm"
    with open(filename, 'w', encoding='utf-8') as file:
        file.write(driver.page_source)

    driver.quit()
    data = get_dividends(filename)
    latest = data[-10:]
    print(latest)