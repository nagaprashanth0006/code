class parent():
    def __init__(self):
        print("From parent constructor")
    def test1(self, param):
        return param * 2

class child(parent):
    def __init__(self, param):
        print("From child constructor. Param:", param)
    def test1(self, param):
        return parent.test1(self, param) * 2

obj1 = child(10)
obj2 = parent()
print(obj1.test1(11))
print(obj2.test1(12))
