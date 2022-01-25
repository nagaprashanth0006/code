def calculate_sma(prices, window):
    sma = [sum(prices[i - window : i]) / window for i in range(window, len(prices) + 1)]
    return sma

def backtest_strategy(prices, fast_sma, slow_sma):
    signals = []
    position_open = False
    for i in range(1, min(len(fast_sma), len(slow_sma))):
        if fast_sma[i] > slow_sma[i] and not position_open:
            signals.append(("Long", i + 5))  # +5 because slow SMA has 5-day window
            position_open = True
        elif fast_sma[i] < slow_sma[i] and position_open:
            signals.append(
                ("Close", i + 5)
            )  # +5 for alignment with the actual price list
            position_open = False
    return signals

prices = list(map(float, open("..\closes-sbin-2000.csv").read().split()[1:71]))
prices = [round(x, 1) for x in prices]

fast_sma = calculate_sma(prices, 3)
slow_sma = calculate_sma(prices, 5)

signals = backtest_strategy(prices, fast_sma, slow_sma)

print("Strategy signals (position, day index):")
for signal in signals:
    print(signal)
