with open(r'c:\Users\Admin\Documents\GitHub\DealChat\html\seller_editor.html', 'r', encoding='utf-8') as f:
    text = f.read()
    print(f"div: {text.count('<div')} / {text.count('</div')}")
    print(f"nav: {text.count('<nav')} / {text.count('</nav')}")
    print(f"aside: {text.count('<aside')} / {text.count('</aside')}")
    print(f"main: {text.count('<main')} / {text.count('</main')}")
    print(f"section: {text.count('<section')} / {text.count('</section')}")
