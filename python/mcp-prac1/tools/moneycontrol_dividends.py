from bs4 import BeautifulSoup as BS
from tabulate import tabulate
from sys import argv

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

    print(tabulate(sorted(data, key = lambda x: x[3]), headers=columns, tablefmt='pretty', stralign='center', numalign='center'))

if __name__ == "__main__":
    get_dividends()