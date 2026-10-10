from time import sleep
from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
from datetime import date
import moneycontrol_dividends

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


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
moneycontrol_dividends.get_dividends(filename)